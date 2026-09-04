-- F9-RECEP-17 — la configuración de Recepción por negocio.
--
-- Dos cosas decide el negocio (Carlos, 2026-09-04):
--   1. Cómo llama a su «cliente». Un consultorio dice paciente, una escuela
--      alumno, un hotel huésped. UNA palabra sin espacios, guardada ya
--      Capitalizada; NULL = usa la palabra de fábrica del idioma. El web la
--      interpola en todos los textos del módulo — y SOLO de este módulo.
--   2. Qué entradas del menú muestra: el registro y los turnos, cada una por
--      su cuenta. Con las dos apagadas el grupo desaparece del menú sin tocar
--      el plan: «quitar el módulo» para quien lo usa, sin que el backoffice
--      lo desactive.
--
-- Sin fila, todo visible y sin palabra propia: los MISMOS defaults que las
-- columnas, para que «nunca configuré» y «configuré y no toqué nada» sean lo
-- mismo. Una fila por tenant: la PK es el tenant.
--
-- El CHECK repite en la base lo que el DTO ya exige: la palabra no lleva
-- espacios de ninguna clase ni queda vacía. La RLS va en ESTA migración.

CREATE TABLE "reception_settings" (
    "tenant_id"      UUID NOT NULL,
    "customer_label" VARCHAR(40),
    "show_customers" BOOLEAN NOT NULL DEFAULT true,
    "show_turns"     BOOLEAN NOT NULL DEFAULT true,
    "updated_by"     UUID,
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"     TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reception_settings_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "reception_settings_customer_label_one_word" CHECK (
      "customer_label" IS NULL
      OR (btrim("customer_label") <> '' AND "customer_label" !~ '\s')
    )
);

ALTER TABLE "reception_settings" ADD CONSTRAINT "reception_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reception_settings" ADD CONSTRAINT "reception_settings_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reception_settings']
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
