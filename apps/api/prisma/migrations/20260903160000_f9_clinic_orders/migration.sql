-- F9-CLINIC-04 — las órdenes médicas (receta, laboratorio, diagnóstico) y sus líneas.
--
-- Una orden que SE COBRA nace pegada a su cotización: `folio` es el MISMO
-- string que `quotes.folio` (`COT-…`) y `quote_id` la apunta (UNIQUE: una
-- cotización, una orden). Una orden que NO se cobra (el negocio no vende ese
-- tipo, F9-CLINIC-23) toma folio de la serie propia `ORM` y `quote_id` NULL.
-- El CHECK «el prefijo no miente» amarra las dos cosas.
--
-- Las líneas llevan `order_kind` denormalizado con FK COMPUESTA
-- `(order_id, order_kind) → orders(id, kind)` y un CHECK que exige que el tipo
-- de línea coincida con el de su orden: en la BASE es imposible meter un
-- estudio de gabinete en una receta, sin un `if` de servicio que alguien
-- pueda olvidar. Snapshots (`description`, `unit_price`): el papel decía ESTO.
--
-- La RLS va en ESTA migración, no en una posterior.

CREATE TABLE "medical_clinic_orders" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "record_id"   UUID NOT NULL,
    "kind"        VARCHAR(16) NOT NULL,
    "folio"       VARCHAR(32) NOT NULL,
    "quote_id"    UUID,
    "indications" TEXT,
    "diagnosis"   TEXT,
    "status"      VARCHAR(16) NOT NULL DEFAULT 'issued',
    "canceled_at" TIMESTAMPTZ(6),
    "canceled_by" UUID,
    "created_by"  UUID NOT NULL,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medical_clinic_orders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "medical_clinic_orders" ADD CONSTRAINT "medical_clinic_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_orders" ADD CONSTRAINT "medical_clinic_orders_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "medical_clinic_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_orders" ADD CONSTRAINT "medical_clinic_orders_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_orders" ADD CONSTRAINT "medical_clinic_orders_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_orders" ADD CONSTRAINT "medical_clinic_orders_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "medical_clinic_orders_tenant_id_folio_key" ON "medical_clinic_orders" ("tenant_id", "folio");
-- Postgres trata los NULL como distintos: varias órdenes sin cotización caben.
CREATE UNIQUE INDEX "medical_clinic_orders_quote_id_key" ON "medical_clinic_orders" ("quote_id");
-- El ancla de la FK compuesta de las líneas.
CREATE UNIQUE INDEX "medical_clinic_orders_id_kind_key" ON "medical_clinic_orders" ("id", "kind");
CREATE INDEX "medical_clinic_orders_tenant_id_record_id_idx" ON "medical_clinic_orders" ("tenant_id", "record_id");

ALTER TABLE "medical_clinic_orders"
  ADD CONSTRAINT "medical_clinic_orders_kind_check" CHECK ("kind" IN ('prescription', 'lab_order', 'diagnostic_order'));
ALTER TABLE "medical_clinic_orders"
  ADD CONSTRAINT "medical_clinic_orders_status_check" CHECK ("status" IN ('issued', 'canceled'));
ALTER TABLE "medical_clinic_orders"
  ADD CONSTRAINT "medical_clinic_orders_canceled_coherent" CHECK (("status" = 'canceled') = ("canceled_at" IS NOT NULL));
ALTER TABLE "medical_clinic_orders"
  ADD CONSTRAINT "medical_clinic_orders_canceled_by_coherent" CHECK (("canceled_by" IS NULL) = ("canceled_at" IS NULL));
-- El prefijo no miente: COT- ⇔ hay cotización.
ALTER TABLE "medical_clinic_orders"
  ADD CONSTRAINT "medical_clinic_orders_folio_quote_coherent" CHECK (("folio" LIKE 'COT-%') = ("quote_id" IS NOT NULL));

CREATE TABLE "medical_clinic_order_lines" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"           UUID NOT NULL,
    "order_id"            UUID NOT NULL,
    "order_kind"          VARCHAR(16) NOT NULL,
    "line_no"             INTEGER NOT NULL,
    "product_id"          UUID,
    "presentation_id"     UUID,
    "lab_study_id"        UUID,
    "diagnostic_study_id" UUID,
    "description"         TEXT NOT NULL,
    "quantity"            DECIMAL(14,4) NOT NULL,
    "unit_price"          DECIMAL(14,2) NOT NULL,
    "dosage"              TEXT,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "medical_clinic_order_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "medical_clinic_order_lines" ADD CONSTRAINT "medical_clinic_order_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_order_lines" ADD CONSTRAINT "medical_clinic_order_lines_order_id_order_kind_fkey"
  FOREIGN KEY ("order_id", "order_kind") REFERENCES "medical_clinic_orders"("id", "kind") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_order_lines" ADD CONSTRAINT "medical_clinic_order_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_order_lines" ADD CONSTRAINT "medical_clinic_order_lines_presentation_id_fkey"
  FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_order_lines" ADD CONSTRAINT "medical_clinic_order_lines_lab_study_id_fkey"
  FOREIGN KEY ("lab_study_id") REFERENCES "medical_clinic_lab_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_order_lines" ADD CONSTRAINT "medical_clinic_order_lines_diagnostic_study_id_fkey"
  FOREIGN KEY ("diagnostic_study_id") REFERENCES "medical_clinic_diagnostic_studies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "medical_clinic_order_lines_order_id_line_no_key" ON "medical_clinic_order_lines" ("order_id", "line_no");
CREATE INDEX "medical_clinic_order_lines_tenant_id_idx" ON "medical_clinic_order_lines" ("tenant_id");

ALTER TABLE "medical_clinic_order_lines"
  ADD CONSTRAINT "medical_clinic_order_lines_one_reference" CHECK (num_nonnulls("product_id", "lab_study_id", "diagnostic_study_id") = 1);
ALTER TABLE "medical_clinic_order_lines"
  ADD CONSTRAINT "medical_clinic_order_lines_presentation_only_for_products" CHECK ("presentation_id" IS NULL OR "product_id" IS NOT NULL);
ALTER TABLE "medical_clinic_order_lines"
  ADD CONSTRAINT "medical_clinic_order_lines_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "medical_clinic_order_lines"
  ADD CONSTRAINT "medical_clinic_order_lines_unit_price_non_negative" CHECK ("unit_price" >= 0);
-- El tipo de la línea no puede contradecir el de su orden.
ALTER TABLE "medical_clinic_order_lines"
  ADD CONSTRAINT "medical_clinic_order_lines_kind_shape" CHECK (
    ("order_kind" = 'prescription' AND "product_id" IS NOT NULL)
    OR ("order_kind" = 'lab_order' AND "lab_study_id" IS NOT NULL)
    OR ("order_kind" = 'diagnostic_order' AND "diagnostic_study_id" IS NOT NULL)
  );

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['medical_clinic_orders', 'medical_clinic_order_lines']
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
