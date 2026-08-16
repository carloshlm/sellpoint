-- F2-DB-09: RLS en las 8 tablas nuevas con `tenant_id`.
--
-- Patrón canónico heredado de F1 (`20260813211500_f1_scope_enable_rls`), con
-- las tres decisiones que ya costaron incidentes:
--
-- 1. ENABLE + **FORCE**: sin FORCE, el owner de las tablas queda exento de sus
--    propias policies. Como las migraciones y el seed conectan con ese rol, el
--    aislamiento sería teatro para cualquier conexión que lo use.
--
-- 2. **NULLIF(current_setting(...), '')**: una conexión reciclada por el pool
--    puede devolver '' en vez de NULL, y `''::uuid` REVIENTA en vez de filtrar
--    a cero filas. El bug original está documentado en
--    `20260807033400_auth_login_gateway` § 3.
--
-- 3. `USING` **y** `WITH CHECK` idénticos: el USING filtra lo que se lee, el
--    WITH CHECK impide escribir filas de otro tenant. Sin el segundo, un INSERT
--    cross-tenant pasa.
--
-- `units` NO lleva RLS a propósito: es catálogo global sin `tenant_id`, igual
-- que `currencies` y `permissions`.
--
-- Los grants no se declaran: los cubre el ALTER DEFAULT PRIVILEGES de
-- `20260806172006_app_db_user`.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'catalogs',
    'catalog_fields',
    'catalog_records',
    'products',
    'product_presentations',
    'product_compositions',
    'warehouses',
    'stock_by_warehouse'
  ]
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
