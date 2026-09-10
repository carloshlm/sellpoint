-- F9-EXP-04 — el GASTO: un egreso operativo que no toca inventario.
--
-- Un gasto es UNA línea y sus totales salen del mismo sumador que la venta
-- (`armarTotales`, quantity 1): `amount` es lo capturado, `discount` un monto
-- fijo, `tax_rates` el snapshot del grupo con la FORMA EXACTA de `sale_taxes`
-- ({code,name,rate,base,amount,sortOrder}) para que el IVA acreditable de
-- mañana sea un `jsonb_to_recordset`, no un recálculo.
--
-- Dos hechos ORTOGONALES: `status` (existe o se anuló) y `payment_status`
-- (pendiente o pagado). Cada uno con su CHECK de coherencia: pagado exige
-- método y fecha; anulado exige quién, cuándo y por qué.
--
-- `warehouse_id NOT NULL`: el gasto es de UNA sucursal, para que la utilidad
-- neta acotada por alcance reste solo los gastos de lo que se mira. Sin él
-- sería «la utilidad de nadie».
--
-- `cashbox_session_id` solo con `cash`: es el gasto que SALE del cajón de un
-- turno y que el cierre resta del efectivo esperado (decisión de Carlos,
-- 2026-09-10). Un pago con tarjeta o transferencia no toca ningún cajón.
--
-- `expense_date DATE`: un día del calendario del negocio, sin zona. Se
-- compara DATE con DATE (`localCalendarDate`), nunca con un instante UTC.
--
-- Las FK a categoría, proveedor y sesión son RESTRICT, jamás SET NULL: un
-- gasto huérfano de categoría no se reporta, y el 409 de «en uso» es lo que
-- empuja a desactivar en vez de borrar.

CREATE TABLE "expenses" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "folio"              VARCHAR(32) NOT NULL,
    "warehouse_id"       UUID NOT NULL,
    "expense_date"       DATE NOT NULL,
    "category_id"        UUID NOT NULL,
    "supplier_id"        UUID,
    "beneficiary"        VARCHAR(120),
    "description"        VARCHAR(300) NOT NULL,
    "reference"          VARCHAR(120),
    "amount"             NUMERIC(14,2) NOT NULL,
    "discount"           NUMERIC(14,2) NOT NULL DEFAULT 0,
    "tax_group_code"     VARCHAR(32),
    "tax_rates"          JSONB NOT NULL DEFAULT '[]',
    "tax_amount"         NUMERIC(14,2) NOT NULL DEFAULT 0,
    "total"              NUMERIC(14,2) NOT NULL,
    "tax_mode"           VARCHAR(8) NOT NULL,
    "status"             VARCHAR(16) NOT NULL DEFAULT 'active',
    "payment_status"     VARCHAR(16) NOT NULL DEFAULT 'pending',
    "payment_method"     "PaymentMethod",
    "paid_at"            TIMESTAMPTZ(6),
    "due_date"           DATE,
    "cashbox_session_id" UUID,
    "account_ref"        VARCHAR(120),
    "notes"              TEXT,
    "created_by"         UUID NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL,
    "canceled_by"        UUID,
    "canceled_at"        TIMESTAMPTZ(6),
    "cancel_reason"      TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "expense_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cashbox_session_id_fkey"
  FOREIGN KEY ("cashbox_session_id") REFERENCES "cashbox_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "expenses_tenant_id_folio_key" ON "expenses" ("tenant_id", "folio");
CREATE INDEX "expenses_tenant_id_expense_date_idx" ON "expenses" ("tenant_id", "expense_date" DESC);
CREATE INDEX "expenses_tenant_id_status_payment_status_idx"
  ON "expenses" ("tenant_id", "status", "payment_status");
CREATE INDEX "expenses_tenant_id_category_id_idx" ON "expenses" ("tenant_id", "category_id");
CREATE INDEX "expenses_cashbox_session_id_idx"
  ON "expenses" ("cashbox_session_id") WHERE "cashbox_session_id" IS NOT NULL;
CREATE INDEX "expenses_supplier_id_idx" ON "expenses" ("supplier_id") WHERE "supplier_id" IS NOT NULL;

-- Los montos y los catálogos cerrados.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_check" CHECK ("amount" > 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_discount_check"
  CHECK ("discount" >= 0 AND "discount" <= "amount");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_total_check"
  CHECK ("tax_amount" >= 0 AND "total" >= 0);
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_status_check"
  CHECK ("status" IN ('active', 'canceled'));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payment_status_check"
  CHECK ("payment_status" IN ('pending', 'paid'));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_mode_check"
  CHECK ("tax_mode" IN ('included', 'excluded'));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_description_check" CHECK (btrim("description") <> '');

-- La coherencia entre los dos hechos y sus sellos.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_coherent"
  CHECK (("payment_status" = 'paid') = ("payment_method" IS NOT NULL AND "paid_at" IS NOT NULL));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_session_only_cash"
  CHECK ("cashbox_session_id" IS NULL OR "payment_method" = 'cash');
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_canceled_coherent"
  CHECK (("status" = 'canceled') =
         ("canceled_at" IS NOT NULL AND "canceled_by" IS NOT NULL AND "cancel_reason" IS NOT NULL));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payee_xor"
  CHECK (NOT ("supplier_id" IS NOT NULL AND "beneficiary" IS NOT NULL));
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_needs_group"
  CHECK ("tax_amount" = 0 OR "tax_group_code" IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expenses']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
