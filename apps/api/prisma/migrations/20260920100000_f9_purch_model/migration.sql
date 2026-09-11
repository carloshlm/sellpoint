-- F9-PURCH-02 — la COMPRA a un proveedor: la factura capturada.
--
-- ── La compra TRANSPORTA, la entrada EXIGE ───────────────────────────────
--
-- Esta tabla no mueve inventario: registra lo que el proveedor facturó y, al
-- confirmarse, ofrece un borrador de ENTRADA (`inventory_documents`) con sus
-- líneas precargadas. La entrada es la que exige lo que el inventario exige
-- —lote, caducidad, ubicación, presentaciones enteras— y es la que al
-- confirmarse mueve el stock. Por eso acá los campos son laxos (una línea sin
-- cantidad es un borrador a medio capturar) y el rigor vive en el `confirm`.
--
-- ── Por qué `unit_cost_net` existe además de `unit_cost` ────────────────
--
-- El costo que viaja a la entrada PISA `product_presentations.cost` y alimenta
-- el costo promedio del inventario. La factura viene en neto + IVA
-- (`tax_mode = 'excluded'`, al revés que el mostrador), así que mandar el
-- bruto inflaría el margen un 16 % para siempre. `unit_cost_net` se
-- materializa al confirmar —`(line_total − tax_amount) / quantity`— y es lo
-- único que cruza el puente.
--
-- ── La asimetría del trigger ─────────────────────────────────────────────
--
-- Las TRES tablas hijas heredan la inmutabilidad del padre (molde
-- `20260818041500_f3_document_immutability`): una compra confirmada no cambia
-- de líneas, ni de impuestos, ni de cargos — su PDF ya se imprimió. Pero la
-- CABECERA sí se edita después: la mercancía llega días más tarde y hay que
-- anotar `received_date`, el número de factura definitivo o una nota. Por eso
-- NO hay trigger sobre `purchases` y el candado de esos tres campos vive en el
-- service (`PATCH /:id/reception`), que es donde se puede distinguir.

CREATE TABLE "purchases" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"           UUID NOT NULL,
    "folio"               VARCHAR(20) NOT NULL,
    "status"              VARCHAR(16) NOT NULL DEFAULT 'draft',
    "supplier_id"         UUID NOT NULL,
    "warehouse_id"        UUID NOT NULL,
    "purchase_date"       DATE NOT NULL,
    "received_date"       DATE,
    "supplier_invoice"    VARCHAR(120),
    -- Lo que dice el PAPEL. El descuadre contra `total` se DERIVA
    -- (`totalMismatch` en shared), avisa y nunca bloquea.
    "declared_total"      NUMERIC(14,2),
    "subtotal"            NUMERIC(14,2) NOT NULL DEFAULT 0,
    "discount"            NUMERIC(14,2) NOT NULL DEFAULT 0,
    "tax_total"           NUMERIC(14,2) NOT NULL DEFAULT 0,
    "total"               NUMERIC(14,2) NOT NULL DEFAULT 0,
    "extra_charges_total" NUMERIC(14,2) NOT NULL DEFAULT 0,
    "tax_mode"            VARCHAR(8) NOT NULL DEFAULT 'excluded',
    "notes"               TEXT,
    "confirmed_by"        UUID,
    "confirmed_at"        TIMESTAMPTZ(6),
    "canceled_by"         UUID,
    "canceled_at"         TIMESTAMPTZ(6),
    "cancel_reason"       TEXT,
    "created_by"          UUID NOT NULL,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"          TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_confirmed_by_fkey"
  FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchases_tenant_id_folio_key" ON "purchases" ("tenant_id", "folio");
CREATE INDEX "purchases_tenant_id_purchase_date_idx"
  ON "purchases" ("tenant_id", "purchase_date" DESC);
CREATE INDEX "purchases_tenant_id_status_idx" ON "purchases" ("tenant_id", "status");
CREATE INDEX "purchases_tenant_id_supplier_id_purchase_date_idx"
  ON "purchases" ("tenant_id", "supplier_id", "purchase_date" DESC);

ALTER TABLE "purchases" ADD CONSTRAINT "purchases_status_check"
  CHECK ("status" IN ('draft', 'confirmed', 'canceled'));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_tax_mode_check"
  CHECK ("tax_mode" IN ('included', 'excluded'));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_amounts_nonnegative"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "tax_total" >= 0 AND "total" >= 0
         AND "extra_charges_total" >= 0
         AND ("declared_total" IS NULL OR "declared_total" >= 0));
-- Un borrador no tiene sellos; un confirmado tiene el suyo; un anulado tiene
-- el de la anulación (y conserva el de confirmación si lo tuvo: anular una
-- compra confirmada no borra que se confirmó).
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_draft_has_no_stamps"
  CHECK ("status" <> 'draft' OR ("confirmed_at" IS NULL AND "canceled_at" IS NULL));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_confirmed_coherent"
  CHECK ("status" <> 'confirmed'
         OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND "canceled_at" IS NULL));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_canceled_coherent"
  CHECK ("status" <> 'canceled'
         OR ("canceled_at" IS NOT NULL AND "canceled_by" IS NOT NULL
             AND "cancel_reason" IS NOT NULL));
-- SIN `received_date >= purchase_date`: una factura se captura con la fecha
-- del papel y la mercancía pudo llegar antes (remisión primero, factura
-- después). Un CHECK acá frenaría una captura legítima.

-- ─────────────────────────────────────────────────────────────────────────
-- Las líneas: lo que se compró, en la presentación en que se compró
-- ─────────────────────────────────────────────────────────────────────────
--
-- `presentation_id` NULLABLE = la unidad base, igual que en
-- `inventory_document_lines`: el puente copia campo a campo y no inventa
-- conversiones. `quantity` y `unit_cost` son nullables porque un borrador se
-- captura a pedazos; el `confirm` es quien exige que estén.
CREATE TABLE "purchase_lines" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "purchase_id"     UUID NOT NULL,
    "line_no"         INTEGER NOT NULL,
    "product_id"      UUID NOT NULL,
    "presentation_id" UUID,
    "quantity"        NUMERIC(14,4),
    "unit_cost"       NUMERIC(14,2),
    -- Materializado al confirmar: el costo SIN impuesto por unidad de la
    -- presentación. Es lo único que cruza a la entrada.
    "unit_cost_net"   NUMERIC(14,2),
    "discount"        NUMERIC(14,2) NOT NULL DEFAULT 0,
    "tax_group_code"  VARCHAR(32),
    "tax_amount"      NUMERIC(14,2) NOT NULL DEFAULT 0,
    "line_total"      NUMERIC(14,2) NOT NULL DEFAULT 0,
    "lot_code"        VARCHAR(64),
    "expires_at"      DATE,
    -- Snapshot del nombre al capturar: el papel dice lo que decía ese día.
    "description"     TEXT NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_presentation_id_fkey"
  FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_lines_purchase_id_line_no_key"
  ON "purchase_lines" ("purchase_id", "line_no");
CREATE INDEX "purchase_lines_tenant_id_product_id_idx"
  ON "purchase_lines" ("tenant_id", "product_id");

ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_line_no_check" CHECK ("line_no" >= 1);
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_amounts_check"
  CHECK (("quantity" IS NULL OR "quantity" >= 0)
         AND ("unit_cost" IS NULL OR "unit_cost" >= 0)
         AND ("unit_cost_net" IS NULL OR "unit_cost_net" >= 0)
         AND "discount" >= 0 AND "tax_amount" >= 0 AND "line_total" >= 0);
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_description_check"
  CHECK (btrim("description") <> '');

-- ─────────────────────────────────────────────────────────────────────────
-- Los impuestos: espejo exacto de `quote_taxes` y `sale_taxes`
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "purchase_taxes" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "code"        VARCHAR(16) NOT NULL,
    "name"        VARCHAR(40) NOT NULL,
    "rate"        NUMERIC(7,4) NOT NULL,
    "base"        NUMERIC(14,2) NOT NULL,
    "amount"      NUMERIC(14,2) NOT NULL,
    "sort_order"  INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_taxes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_taxes_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100),
    CONSTRAINT "purchase_taxes_amount_nonnegative" CHECK ("amount" >= 0 AND "base" >= 0)
);

ALTER TABLE "purchase_taxes" ADD CONSTRAINT "purchase_taxes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_taxes" ADD CONSTRAINT "purchase_taxes_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_taxes_purchase_id_code_key"
  ON "purchase_taxes" ("purchase_id", "code");
CREATE INDEX "purchase_taxes_tenant_id_idx" ON "purchase_taxes" ("tenant_id");

-- ─────────────────────────────────────────────────────────────────────────
-- Los cargos: flete, maniobras, seguro
-- ─────────────────────────────────────────────────────────────────────────
--
-- Suman al total de la factura y llevan su propio impuesto, pero **no se
-- prorratean al costo de las líneas**: el landed cost queda pospuesto con
-- nombre (F9-PURCH, riesgo 1). Repartir un flete entre veinte productos es
-- una decisión contable que el negocio tiene que poder elegir, no un efecto
-- silencioso de capturar una factura.
CREATE TABLE "purchase_charges" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "purchase_id"    UUID NOT NULL,
    "line_no"        INTEGER NOT NULL,
    "description"    VARCHAR(200) NOT NULL,
    "amount"         NUMERIC(14,2) NOT NULL DEFAULT 0,
    "tax_group_id"   UUID,
    "tax_group_code" VARCHAR(32),
    "tax_amount"     NUMERIC(14,2) NOT NULL DEFAULT 0,
    "line_total"     NUMERIC(14,2) NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "purchase_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_charges_line_no_check" CHECK ("line_no" >= 1),
    CONSTRAINT "purchase_charges_description_check" CHECK (btrim("description") <> ''),
    CONSTRAINT "purchase_charges_amounts_check"
      CHECK ("amount" >= 0 AND "tax_amount" >= 0 AND "line_total" >= 0)
);

ALTER TABLE "purchase_charges" ADD CONSTRAINT "purchase_charges_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_charges" ADD CONSTRAINT "purchase_charges_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_charges" ADD CONSTRAINT "purchase_charges_tax_group_id_fkey"
  FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_charges_purchase_id_line_no_key"
  ON "purchase_charges" ("purchase_id", "line_no");
CREATE INDEX "purchase_charges_tenant_id_idx" ON "purchase_charges" ("tenant_id");

-- ─────────────────────────────────────────────────────────────────────────
-- Lo confirmado es intocable: SOLO las hijas (ver la asimetría, arriba)
-- ─────────────────────────────────────────────────────────────────────────
--
-- El `FOUND` (en vez de comparar el status directo) resuelve el borrado en
-- cascada: al borrar un borrador, Postgres borra las hijas DESPUÉS de que el
-- padre ya no está, así que la búsqueda no encuentra nada y el trigger deja
-- pasar. Misma forma que `inventory_document_line_is_immutable`.
--
-- ⚠ Para quien implemente el `confirm`: el trigger mira el estado del PADRE,
-- así que todo lo que haya que escribir en las hijas —`unit_cost_net`, los
-- `purchase_taxes`— va ANTES de mover `purchases.status`. Terminar el
-- contenido y recién entonces sellar.
CREATE OR REPLACE FUNCTION public.purchase_child_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_purchase_id uuid := COALESCE(NEW.purchase_id, OLD.purchase_id);
  v_folio text;
  v_status text;
BEGIN
  SELECT p.folio, p.status INTO v_folio, v_status
  FROM public.purchases p
  WHERE p.id = v_purchase_id AND p.status <> 'draft';

  IF FOUND THEN
    RAISE EXCEPTION
      'La compra % (%) ya no es un borrador: sus líneas, impuestos y cargos no se agregan, modifican ni borran.',
      v_folio, v_status
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

COMMENT ON FUNCTION public.purchase_child_is_immutable() IS
  'F9-PURCH-02: las líneas, impuestos y cargos heredan la inmutabilidad de su compra. La CABECERA no lleva trigger a propósito: recepción, factura y notas se editan después de confirmar.';

CREATE TRIGGER purchase_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_lines"
  FOR EACH ROW EXECUTE FUNCTION public.purchase_child_is_immutable();

CREATE TRIGGER purchase_taxes_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_taxes"
  FOR EACH ROW EXECUTE FUNCTION public.purchase_child_is_immutable();

CREATE TRIGGER purchase_charges_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_charges"
  FOR EACH ROW EXECUTE FUNCTION public.purchase_child_is_immutable();

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchases', 'purchase_lines', 'purchase_taxes', 'purchase_charges']
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
