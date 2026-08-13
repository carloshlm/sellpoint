-- F1-SCOPE-02: RLS + policy tenant_isolation en user_warehouse_scopes.
-- Mismo patrón que 20260806171516_enable_rls_tenant_isolation, pero con el
-- fix NULLIF ya incorporado desde el nacimiento de la policy (ver
-- 20260807033400_auth_login_gateway §3 para el bug original: sin NULLIF,
-- current_setting('app.tenant_id', true) puede devolver '' en vez de NULL
-- para una conexión reciclada por el pool, y ''::uuid revienta en vez de
-- filtrar a 0 filas).
--
-- FORCE ROW LEVEL SECURITY: igual que las demás tablas con tenant_id, la app
-- conecta como el owner de las tablas (sellpoint) en migraciones/seed, así
-- que sin FORCE el aislamiento sería teatro para cualquier conexión que use
-- ese rol.
ALTER TABLE "user_warehouse_scopes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_warehouse_scopes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "user_warehouse_scopes"
  FOR ALL
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
