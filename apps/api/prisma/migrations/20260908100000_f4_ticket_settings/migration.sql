-- F4-TICKETCFG-02 — la configuración del ticket por negocio.
--
-- Qué del negocio se IMPRIME (toggles) y con qué logotipo. Los toggles no
-- editan nada: `tenants` y `warehouses` siguen siendo la única verdad de esos
-- datos; aquí solo se decide si salen en el papel.
--
-- El logotipo propio vive en ESTA fila como `bytea`, procesado ya por el API
-- (gris, ≤ 384×160, PNG ≤ 64 KB). Sin archivos ni S3: reemplazarlo es un
-- UPDATE y la imagen anterior desaparece con él, sin job de limpieza. El
-- CHECK de tamaño es el cinturón por si el procesador se relaja un día.
--
-- Sin fila valen los defaults de shared, que son los mismos que las columnas.
-- La RLS va en ESTA migración.

CREATE TABLE "ticket_settings" (
    "tenant_id"          UUID NOT NULL,
    "show_business_name" BOOLEAN NOT NULL DEFAULT true,
    "show_tax_id"        BOOLEAN NOT NULL DEFAULT true,
    "show_address"       BOOLEAN NOT NULL DEFAULT true,
    "show_phone"         BOOLEAN NOT NULL DEFAULT true,
    "show_warehouse"     BOOLEAN NOT NULL DEFAULT true,
    "footer_message"     VARCHAR(160),
    "logo_kind"          VARCHAR(8) NOT NULL DEFAULT 'none',
    "logo_preset"        VARCHAR(32),
    "logo_png"           BYTEA,
    "logo_width"         INTEGER,
    "logo_height"        INTEGER,
    "updated_by"         UUID,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ticket_settings_pkey" PRIMARY KEY ("tenant_id"),
    CONSTRAINT "ticket_settings_logo_kind_check"
      CHECK ("logo_kind" IN ('none', 'preset', 'custom')),
    -- La forma del logotipo va con su tipo: un preset no lleva bytes y una
    -- imagen propia no lleva preset; sin logotipo no hay nada de nada.
    CONSTRAINT "ticket_settings_logo_shape" CHECK (
      ("logo_kind" = 'none'   AND "logo_preset" IS NULL AND "logo_png" IS NULL
                              AND "logo_width" IS NULL AND "logo_height" IS NULL)
      OR ("logo_kind" = 'preset' AND "logo_preset" IS NOT NULL AND "logo_png" IS NULL
                              AND "logo_width" IS NULL AND "logo_height" IS NULL)
      OR ("logo_kind" = 'custom' AND "logo_preset" IS NULL AND "logo_png" IS NOT NULL
                              AND "logo_width" > 0 AND "logo_height" > 0)
    ),
    CONSTRAINT "ticket_settings_logo_size" CHECK (
      "logo_png" IS NULL OR octet_length("logo_png") <= 65536
    )
);

ALTER TABLE "ticket_settings" ADD CONSTRAINT "ticket_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ticket_settings" ADD CONSTRAINT "ticket_settings_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ticket_settings']
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
