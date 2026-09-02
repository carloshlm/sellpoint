-- F9-RECEP-02 — la PERSONA del negocio: el cliente.
--
-- Se llama `customers` y no `reception_persons` a propósito: la tabla nombra a
-- la persona, no a la pantalla que hoy la captura. Cotizaciones, ventas y lo
-- clínico van a colgar de ella (`patients` será una extensión 1‑1, nunca una
-- segunda tabla de personas).
--
-- `birth_date` y no `age`: la edad se CALCULA (Carlos, 2026-09-02). Un entero
-- es correcto el día que se teclea y miente el resto del año.
--
-- `attributes` nace sin motor de catálogos: la columna y su GIN cuestan cero
-- hoy y evitan una migración después; cablear `assertSystemCatalogAttributes`
-- exige un catálogo de sistema con backfill para todos los tenants.
--
-- La RLS va en ESTA migración, no en una posterior.

CREATE TABLE "customers" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "first_name"         TEXT NOT NULL,
    "last_name_paternal" TEXT NOT NULL,
    "last_name_maternal" TEXT,
    "birth_date"         DATE,
    "phone"              VARCHAR(20),
    "email"              TEXT,
    "notes"              TEXT,
    "attributes"         JSONB NOT NULL DEFAULT '{}',
    "is_active"          BOOLEAN NOT NULL DEFAULT true,
    "created_by"         UUID,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El listado va del más reciente al más viejo; el teléfono es la búsqueda
-- rápida de mostrador.
CREATE INDEX "customers_tenant_id_created_at_idx" ON "customers" ("tenant_id", "created_at" DESC);
CREATE INDEX "customers_tenant_id_phone_idx" ON "customers" ("tenant_id", "phone");
CREATE INDEX "customers_attributes_idx" ON "customers" USING GIN ("attributes" jsonb_path_ops);

-- Nadie nace mañana; el teléfono es E.164 (misma regla que `tenants.phone`).
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_birth_date_check" CHECK ("birth_date" IS NULL OR "birth_date" <= CURRENT_DATE);
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9]\d{1,14}$');

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers']
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
