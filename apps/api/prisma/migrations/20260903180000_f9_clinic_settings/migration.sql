-- F9-CLINIC-21 — la configuración del Consultorio Médico por negocio.
--
-- Qué vende el consultorio decide si una orden médica crea cotización
-- (F9-CLINIC-23). Sin fila, el negocio vende solo medicamentos: la mayoría de
-- los consultorios no vende estudios (Carlos, 2026-09-03), y por eso los dos
-- estudios NACEN desmarcados. Una fila por tenant: la PK es el tenant.
--
-- La RLS va en ESTA migración, no en una posterior.

CREATE TABLE "medical_clinic_settings" (
    "tenant_id"                UUID NOT NULL,
    "sells_medications"        BOOLEAN NOT NULL DEFAULT true,
    "sells_lab_studies"        BOOLEAN NOT NULL DEFAULT false,
    "sells_diagnostic_studies" BOOLEAN NOT NULL DEFAULT false,
    "updated_by"               UUID,
    "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"               TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "medical_clinic_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "medical_clinic_settings" ADD CONSTRAINT "medical_clinic_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medical_clinic_settings" ADD CONSTRAINT "medical_clinic_settings_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['medical_clinic_settings']
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
