-- F9-CLINIC-02 — los dos catálogos de estudios del Consultorio Médico.
--
-- Dos tablas idénticas y no una con `kind`: hoy se parecen, pero divergen por
-- naturaleza (laboratorio: muestra, tubo, ayuno, valores de referencia;
-- gabinete: modalidad, equipo, preparación). Separarlas después sería una
-- migración con datos; unirlas después, una migración sola.
--
-- SIN `service_warehouses`: son catálogos del NEGOCIO, no de un almacén. Por
-- eso no salen en el buscador del POS (que filtra servicios por almacén):
-- llegan a la caja por la cotización de la orden médica (F9-CLINIC-14).
--
-- `attributes` nace sin motor de catálogos, igual que en `customers`. La RLS
-- va en ESTA migración, no en una posterior.

CREATE TABLE "medical_clinic_lab_studies" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "code"        VARCHAR(64) NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "cost"        DECIMAL(14,2),
    "price"       DECIMAL(14,2),
    "attributes"  JSONB NOT NULL DEFAULT '{}',
    "is_active"   BOOLEAN NOT NULL DEFAULT true,
    "created_by"  UUID,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medical_clinic_lab_studies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "medical_clinic_lab_studies" ADD CONSTRAINT "medical_clinic_lab_studies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_lab_studies" ADD CONSTRAINT "medical_clinic_lab_studies_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "medical_clinic_lab_studies_tenant_id_code_key" ON "medical_clinic_lab_studies" ("tenant_id", "code");
CREATE INDEX "medical_clinic_lab_studies_tenant_id_idx" ON "medical_clinic_lab_studies" ("tenant_id");
CREATE INDEX "medical_clinic_lab_studies_tenant_id_name_idx" ON "medical_clinic_lab_studies" ("tenant_id", "name");

ALTER TABLE "medical_clinic_lab_studies" ADD CONSTRAINT "medical_clinic_lab_studies_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0);
ALTER TABLE "medical_clinic_lab_studies" ADD CONSTRAINT "medical_clinic_lab_studies_price_check" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "medical_clinic_lab_studies" ADD CONSTRAINT "medical_clinic_lab_studies_code_check" CHECK (btrim("code") <> '' AND btrim("name") <> '');

CREATE TABLE "medical_clinic_diagnostic_studies" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "code"        VARCHAR(64) NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "cost"        DECIMAL(14,2),
    "price"       DECIMAL(14,2),
    "attributes"  JSONB NOT NULL DEFAULT '{}',
    "is_active"   BOOLEAN NOT NULL DEFAULT true,
    "created_by"  UUID,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medical_clinic_diagnostic_studies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "medical_clinic_diagnostic_studies" ADD CONSTRAINT "medical_clinic_diagnostic_studies_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_diagnostic_studies" ADD CONSTRAINT "medical_clinic_diagnostic_studies_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "medical_clinic_diagnostic_studies_tenant_id_code_key" ON "medical_clinic_diagnostic_studies" ("tenant_id", "code");
CREATE INDEX "medical_clinic_diagnostic_studies_tenant_id_idx" ON "medical_clinic_diagnostic_studies" ("tenant_id");
CREATE INDEX "medical_clinic_diagnostic_studies_tenant_id_name_idx" ON "medical_clinic_diagnostic_studies" ("tenant_id", "name");

ALTER TABLE "medical_clinic_diagnostic_studies" ADD CONSTRAINT "medical_clinic_diagnostic_studies_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0);
ALTER TABLE "medical_clinic_diagnostic_studies" ADD CONSTRAINT "medical_clinic_diagnostic_studies_price_check" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "medical_clinic_diagnostic_studies" ADD CONSTRAINT "medical_clinic_diagnostic_studies_code_check" CHECK (btrim("code") <> '' AND btrim("name") <> '');


-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['medical_clinic_lab_studies', 'medical_clinic_diagnostic_studies']
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
