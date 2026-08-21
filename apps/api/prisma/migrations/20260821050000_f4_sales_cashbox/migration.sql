-- F4-DB-01 — Los modelos que hacen posible vender: turno de caja, venta y sus
-- líneas.
--
-- La RLS va en ESTA migración, no en la siguiente: una tabla no debería
-- existir ni un commit sin aislamiento (lección de F3-DOC-03). Los GRANTs no
-- se declaran — los cubre el ALTER DEFAULT PRIVILEGES de
-- `20260806172006_app_db_user`.

CREATE TYPE "CashboxSessionStatus" AS ENUM ('open', 'closed');
CREATE TYPE "SaleStatus" AS ENUM ('completed', 'canceled');
CREATE TYPE "PaymentMethod" AS ENUM ('cash', 'card', 'transfer');

-- ─────────────────────────────────────────────────────────────────────────
-- cashbox_sessions — el turno
--
-- `warehouse_id` NOT NULL es la razón de existir de la tabla: el POS no puede
-- vender desde una LISTA. El alcance dice dónde PUEDE operar alguien y el
-- almacén asignado desde dónde opera por defecto, pero descontar stock exige
-- uno concreto. El turno lo fija y la venta lo hereda.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "cashbox_sessions" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "warehouse_id"    UUID NOT NULL,
    "status"          "CashboxSessionStatus" NOT NULL DEFAULT 'open',
    "opened_by"       UUID NOT NULL,
    "opened_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "closed_by"       UUID,
    "closed_at"       TIMESTAMPTZ(6),
    "declared_cash"   DECIMAL(14,2),
    "calculated_cash" DECIMAL(14,2),
    "cash_difference" DECIMAL(14,2),
    "closing_note"    TEXT,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "cashbox_sessions_pkey" PRIMARY KEY ("id")
);

-- Un turno cerrado tiene quién y cuándo, o no tiene ninguno de los dos.
-- Equivalencia, no implicación: media verdad en una auditoría es peor que
-- ninguna (mismo criterio que `inventory_documents`).
ALTER TABLE "cashbox_sessions" ADD CONSTRAINT "cashbox_sessions_closed_coherent"
  CHECK (("closed_by" IS NULL) = ("closed_at" IS NULL));

-- Un turno CERRADO tiene que estar cerrado de verdad; uno ABIERTO no puede
-- traer fecha de cierre.
ALTER TABLE "cashbox_sessions" ADD CONSTRAINT "cashbox_sessions_status_coherent"
  CHECK (
    ("status" = 'closed' AND "closed_at" IS NOT NULL)
    OR ("status" = 'open' AND "closed_at" IS NULL)
  );

-- ⚠ LA INVARIANTE DEL MÓDULO: **un solo turno abierto por usuario**.
--
-- Es un UNIQUE PARCIAL y no un guard del service porque dos pestañas abriendo
-- turno a la vez pasan cualquier chequeo de "¿ya tiene uno?" que lea antes de
-- escribir. Con esto, la segunda choca contra la base y el service lo traduce
-- a 409 `pos.session_already_open` (F4-CASHBOX-01).
--
-- Los turnos CERRADOS no ocupan lugar — la misma lección que el índice de
-- recepciones anuladas del 2026-08-20: un registro histórico no debe impedir
-- volver a empezar.
CREATE UNIQUE INDEX "cashbox_sessions_one_open_per_user"
  ON "cashbox_sessions" ("opened_by")
  WHERE "status" = 'open';

CREATE INDEX "cashbox_sessions_tenant_id_idx" ON "cashbox_sessions" ("tenant_id");
CREATE INDEX "cashbox_sessions_tenant_warehouse_opened_idx"
  ON "cashbox_sessions" ("tenant_id", "warehouse_id", "opened_at" DESC);

ALTER TABLE "cashbox_sessions" ADD CONSTRAINT "cashbox_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashbox_sessions" ADD CONSTRAINT "cashbox_sessions_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashbox_sessions" ADD CONSTRAINT "cashbox_sessions_opened_by_fkey"
  FOREIGN KEY ("opened_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashbox_sessions" ADD CONSTRAINT "cashbox_sessions_closed_by_fkey"
  FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- sales — la venta
--
-- `quote_id` nace con FK ACTIVA (la tabla `quotes` llega en F4-DB-02, así que
-- la FK se agrega allá). `clinical_document_id` nace SIN FK: la columna existe
-- y la tabla no — es de F9. Tenerla desde ahora evita una migración sobre una
-- tabla con millones de ventas, igual que `user_warehouse_scopes.warehouse_id`
-- esperó a F2.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "sales" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"            UUID NOT NULL,
    "folio"                VARCHAR(32) NOT NULL,
    "warehouse_id"         UUID NOT NULL,
    "cashbox_session_id"   UUID NOT NULL,
    "quote_id"             UUID,
    "clinical_document_id" UUID,
    "status"               "SaleStatus" NOT NULL DEFAULT 'completed',
    "payment_method"       "PaymentMethod" NOT NULL,
    "subtotal"             DECIMAL(14,2) NOT NULL,
    "discount"             DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total"                DECIMAL(14,2) NOT NULL,
    "created_by"           UUID NOT NULL,
    "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "canceled_by"          UUID,
    "canceled_at"          TIMESTAMPTZ(6),
    "cancel_reason"        TEXT,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales" ADD CONSTRAINT "sales_canceled_coherent"
  CHECK (("canceled_by" IS NULL) = ("canceled_at" IS NULL));

ALTER TABLE "sales" ADD CONSTRAINT "sales_status_coherent"
  CHECK (
    ("status" = 'canceled' AND "canceled_at" IS NOT NULL)
    OR ("status" = 'completed' AND "canceled_at" IS NULL)
  );

-- Los importes no son negativos. El descuento tampoco: un "descuento de -50"
-- es un recargo disfrazado, y si algún día se cobran recargos van con su
-- propio nombre.
ALTER TABLE "sales" ADD CONSTRAINT "sales_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "total" >= 0);

CREATE UNIQUE INDEX "sales_tenant_id_folio_key" ON "sales" ("tenant_id", "folio");
-- Una cotización se carga UNA vez: dos ventas no pueden reclamar la misma.
CREATE UNIQUE INDEX "sales_quote_id_key" ON "sales" ("quote_id");
CREATE INDEX "sales_tenant_created_idx" ON "sales" ("tenant_id", "created_at" DESC);
CREATE INDEX "sales_tenant_session_idx" ON "sales" ("tenant_id", "cashbox_session_id");

ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashbox_session_id_fkey"
  FOREIGN KEY ("cashbox_session_id") REFERENCES "cashbox_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales" ADD CONSTRAINT "sales_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- sale_items — un producto O un servicio, nunca los dos ni ninguno
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "sale_items" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "sale_id"         UUID NOT NULL,
    "line_no"         INTEGER NOT NULL,
    "product_id"      UUID,
    "service_id"      UUID,
    "presentation_id" UUID,
    "quantity"        DECIMAL(14,4) NOT NULL,
    "unit_price"      DECIMAL(14,2) NOT NULL,
    "discount"        DECIMAL(14,2) NOT NULL DEFAULT 0,
    "line_total"      DECIMAL(14,2) NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- ⚠ EL CHECK QUE JUSTIFICA LA TABLA.
--
-- Va en la BASE y no en el service porque es una regla sobre la FORMA del
-- dato: una línea sin producto ni servicio no es una línea incompleta, es una
-- imposible. Con dos columnas nullable y sin CHECK, el primer bug de un mapper
-- la escribe y nadie se entera hasta que el ticket sale con un renglón vacío.
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_xor_service"
  CHECK (num_nonnulls("product_id", "service_id") = 1);

-- La presentación es cosa de PRODUCTOS. Un servicio no se vende "por caja".
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_presentation_only_for_products"
  CHECK ("presentation_id" IS NULL OR "product_id" IS NOT NULL);

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_amounts_non_negative"
  CHECK ("unit_price" >= 0 AND "discount" >= 0 AND "line_total" >= 0);

CREATE UNIQUE INDEX "sale_items_sale_id_line_no_key" ON "sale_items" ("sale_id", "line_no");
CREATE INDEX "sale_items_tenant_id_idx" ON "sale_items" ("tenant_id");
CREATE INDEX "sale_items_product_id_idx" ON "sale_items" ("product_id");
CREATE INDEX "sale_items_service_id_idx" ON "sale_items" ("service_id");

ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- CASCADE hacia su venta: la línea no existe sin ella.
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- RESTRICT hacia el catálogo: el histórico de ventas no se borra por limpiar
-- un producto. `service_id` cierra además el `TODO(F4)` de `services.remove` —
-- borrar un servicio ya vendido pasa a ser IMPOSIBLE en la base; el 409 con
-- mensaje amable (`services.has_sales`) llega en F4-SALE-01.
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_presentation_id_fkey"
  FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cashbox_sessions', 'sales', 'sale_items']
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
