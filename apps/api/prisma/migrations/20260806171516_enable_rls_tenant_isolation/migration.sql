-- F1-DB-08 + F1-DB-09: Row-Level Security + policy tenant_isolation
-- en TODAS las tablas con tenant_id (users, roles, audit_logs).
--
-- Decisiones (ver ARQUITECTURA §3.1 + Bitácora):
-- 1. FORCE ROW LEVEL SECURITY: la app conecta como el OWNER de las tablas
--    (user sellpoint) y Postgres EXIME al owner de RLS salvo FORCE.
--    Sin FORCE, el aislamiento seria teatro.
-- 2. current_setting('app.tenant_id', true): el segundo argumento (missing_ok)
--    devuelve NULL si el contexto no fue seteado -> la comparacion da false
--    -> 0 filas, en vez de reventar con ERROR. Fail-closed silencioso.
-- 3. USING + WITH CHECK con la misma condicion: SELECT/UPDATE/DELETE filtran
--    Y ademas INSERT/UPDATE no pueden escribir filas de OTRO tenant.
-- 4. tenants NO lleva RLS aca: no tiene columna tenant_id (su id ES el tenant);
--    su aislamiento se resuelve en la capa de servicio (F1-TENANT).

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "users"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "roles"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "audit_logs"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
