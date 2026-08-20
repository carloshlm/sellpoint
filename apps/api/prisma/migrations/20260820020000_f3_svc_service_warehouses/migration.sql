-- F3-SVC-06 — En qué almacenes se ofrece cada servicio.
--
-- Semántica EXPLÍCITA (decisión de Carlos, 2026-08-19): sin filas, el servicio
-- NO se vende en ningún lado. Es al revés que `user_warehouse_scopes`, donde
-- la lista vacía significa "todos" — acá el checklist ES la disponibilidad.
--
-- La RLS va en ESTA migración: una tabla no debería existir ni un commit sin
-- aislamiento (lección de F3-DOC-03). Los GRANTs no se declaran: los cubre el
-- ALTER DEFAULT PRIVILEGES de `20260806172006_app_db_user`.

CREATE TABLE "service_warehouses" (
    "service_id"   UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "tenant_id"    UUID NOT NULL,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "service_warehouses_pkey" PRIMARY KEY ("service_id", "warehouse_id")
);

CREATE INDEX "service_warehouses_tenant_id_idx" ON "service_warehouses" ("tenant_id");

-- ⚠ El índice que `user_warehouse_scopes` NO tiene, y que acá sí hace falta:
-- la query estrella del POS de F4 es la INVERSA —«qué servicios se ofrecen en
-- ESTE almacén»— y sin él cada búsqueda del carrito sería un scan de la tabla.
CREATE INDEX "service_warehouses_warehouse_id_idx" ON "service_warehouses" ("warehouse_id");

ALTER TABLE "service_warehouses" ADD CONSTRAINT "service_warehouses_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_warehouses" ADD CONSTRAINT "service_warehouses_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_warehouses" ADD CONSTRAINT "service_warehouses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill: lo que YA existe se ofrece en todos los almacenes activos.
--
-- Sin esto, la semántica explícita apagaría en silencio cada servicio ya
-- creado el día que F4 empiece a filtrar por almacén. Un cambio de reglas no
-- puede dejar inservible lo que el usuario ya cargó.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO "service_warehouses" ("service_id", "warehouse_id", "tenant_id")
SELECT s.id, w.id, s.tenant_id
  FROM "services" s
  JOIN "warehouses" w ON w."tenant_id" = s."tenant_id" AND w."is_active" = true
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_warehouses']
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
