-- F9-CLINIC-03 — la historia clínica: un expediente por VISITA y sus secciones.
--
-- Un folio `HCL` por consulta (decisión de Carlos, 2026-09-03): el paciente
-- acumula expedientes, y al abrir uno nuevo se copian sus Datos Generales del
-- anterior. El paciente es `customers` (la persona del negocio) con
-- `ON DELETE SET NULL` + snapshots (`patient_name`, `patient_birth_date`,
-- `patient_sex`): Recepción borra clientes de verdad, y un expediente no puede
-- perder a quién atendió. La edad del encabezado se calcula contra
-- `consultation_date` (el DÍA DEL NEGOCIO), no contra hoy.
--
-- Las 32 secciones viven en UNA tabla (`section_key` + `data` JSONB) con
-- UNIQUE por par: agregar una sección funcional es un schema zod en shared,
-- cero DDL. Sin columna `status`: existe fila ⇔ Completado (se deriva).
--
-- La RLS va en ESTA migración, no en una posterior.

CREATE TABLE "medical_clinic_records" (
    "id"                  UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"           UUID NOT NULL,
    "folio"               VARCHAR(32) NOT NULL,
    "patient_customer_id" UUID,
    "patient_name"        VARCHAR(200) NOT NULL,
    "patient_birth_date"  DATE,
    "patient_sex"         VARCHAR(1),
    "turn_id"             UUID,
    "turn_number"         INTEGER,
    "doctor_user_id"      UUID NOT NULL,
    "consultation_date"   DATE NOT NULL,
    "status"              VARCHAR(16) NOT NULL DEFAULT 'open',
    "closed_at"           TIMESTAMPTZ(6),
    "closed_by"           UUID,
    "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"          TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medical_clinic_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "medical_clinic_records" ADD CONSTRAINT "medical_clinic_records_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_records" ADD CONSTRAINT "medical_clinic_records_patient_customer_id_fkey"
  FOREIGN KEY ("patient_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_records" ADD CONSTRAINT "medical_clinic_records_turn_id_fkey"
  FOREIGN KEY ("turn_id") REFERENCES "reception_turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_records" ADD CONSTRAINT "medical_clinic_records_doctor_user_id_fkey"
  FOREIGN KEY ("doctor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_records" ADD CONSTRAINT "medical_clinic_records_closed_by_fkey"
  FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "medical_clinic_records_tenant_id_folio_key" ON "medical_clinic_records" ("tenant_id", "folio");
-- El historial del paciente y el copy-forward leen el expediente ANTERIOR.
-- Nombre corto explícito: el generado supera los 63 caracteres de Postgres.
CREATE INDEX "medical_clinic_records_patient_history_idx"
  ON "medical_clinic_records" ("tenant_id", "patient_customer_id", "created_at" DESC);
CREATE INDEX "medical_clinic_records_tenant_id_consultation_date_idx"
  ON "medical_clinic_records" ("tenant_id", "consultation_date" DESC);
CREATE INDEX "medical_clinic_records_tenant_id_doctor_user_id_created_at_idx"
  ON "medical_clinic_records" ("tenant_id", "doctor_user_id", "created_at" DESC);

ALTER TABLE "medical_clinic_records"
  ADD CONSTRAINT "medical_clinic_records_status_check" CHECK ("status" IN ('open', 'closed'));
ALTER TABLE "medical_clinic_records"
  ADD CONSTRAINT "medical_clinic_records_patient_sex_check" CHECK ("patient_sex" IS NULL OR "patient_sex" IN ('F', 'M', 'X'));
-- Un expediente cerrado sin cuándo, o un cuándo sin quién, no puede existir ni por bug.
ALTER TABLE "medical_clinic_records"
  ADD CONSTRAINT "medical_clinic_records_closed_coherent" CHECK (("status" = 'closed') = ("closed_at" IS NOT NULL));
ALTER TABLE "medical_clinic_records"
  ADD CONSTRAINT "medical_clinic_records_closed_by_coherent" CHECK (("closed_by" IS NULL) = ("closed_at" IS NULL));

CREATE TABLE "medical_clinic_record_sections" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "record_id"   UUID NOT NULL,
    "section_key" VARCHAR(48) NOT NULL,
    "data"        JSONB NOT NULL DEFAULT '{}',
    "updated_by"  UUID,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medical_clinic_record_sections_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "medical_clinic_record_sections" ADD CONSTRAINT "medical_clinic_record_sections_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- CASCADE: la sección es parte del expediente, no un documento aparte.
ALTER TABLE "medical_clinic_record_sections" ADD CONSTRAINT "medical_clinic_record_sections_record_id_fkey"
  FOREIGN KEY ("record_id") REFERENCES "medical_clinic_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_record_sections" ADD CONSTRAINT "medical_clinic_record_sections_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "medical_clinic_record_sections_record_id_section_key_key"
  ON "medical_clinic_record_sections" ("record_id", "section_key");
CREATE INDEX "medical_clinic_record_sections_tenant_id_idx" ON "medical_clinic_record_sections" ("tenant_id");

-- La clave viene del catálogo de código (sin CHECK de lista, mismo criterio
-- que `tenant_modules.module_key`); el JSON tiene que ser un objeto.
ALTER TABLE "medical_clinic_record_sections"
  ADD CONSTRAINT "medical_clinic_record_sections_section_key_check" CHECK (btrim("section_key") <> '');
ALTER TABLE "medical_clinic_record_sections"
  ADD CONSTRAINT "medical_clinic_record_sections_data_check" CHECK (jsonb_typeof("data") = 'object');

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['medical_clinic_records', 'medical_clinic_record_sections']
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
