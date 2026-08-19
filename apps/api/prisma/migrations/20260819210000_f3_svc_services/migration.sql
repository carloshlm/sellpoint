-- F3-SVC-01 — Catálogo de Servicios.
--
-- Lo que el negocio VENDE pero no almacena. Tabla propia y no un `products`
-- con bandera: `products` arrastra base_unit, tracks_lots, stock_min,
-- composición y presentaciones, todo sin sentido acá — y el costo real de la
-- bandera no es el schema, es el `WHERE is_service = false` que alguien va a
-- olvidar en alguna query de inventario.
--
-- La RLS va en ESTA migración, no en una posterior: una tabla no debería
-- existir ni un commit sin aislamiento (lección de F3-DOC-03).
--
-- Los GRANTs a `sellpoint_app` NO se declaran: los cubre el
-- ALTER DEFAULT PRIVILEGES de `20260806172006_app_db_user`.

CREATE TABLE "services" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "code"        VARCHAR(64) NOT NULL,
    "name"        TEXT NOT NULL,
    "description" TEXT,
    "cost"        DECIMAL(14, 2),
    "price"       DECIMAL(14, 2),
    "is_active"   BOOLEAN NOT NULL DEFAULT true,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- El código es del NEGOCIO, no global: dos tenants pueden usar "CORTE".
CREATE UNIQUE INDEX "services_tenant_id_code_key" ON "services" ("tenant_id", "code");
CREATE INDEX "services_tenant_id_idx" ON "services" ("tenant_id");

ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Importes no negativos. La app ya lo valida con `moneyAmount()`, pero un
-- precio negativo escrito por otra vía sería dinero inventado.
ALTER TABLE "services"
  ADD CONSTRAINT "services_cost_check" CHECK ("cost" IS NULL OR "cost" >= 0);
ALTER TABLE "services"
  ADD CONSTRAINT "services_price_check" CHECK ("price" IS NULL OR "price" >= 0);

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['services']
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
