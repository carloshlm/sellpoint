-- Backfill de los catálogos del sistema "warehouses" y "services" (Carlos,
-- 2026-08-26) para los tenants que YA existen.
--
-- Desde hoy, `TenantsService.provision()` crea los tres catálogos del sistema
-- junto con el tenant. Los tenants registrados antes nacieron solo con el de
-- productos — sin estos dos no podrían definir campos dinámicos de almacenes
-- ni de servicios.
--
-- Idempotente por partida doble: el `NOT EXISTS` evita duplicar y el índice
-- único parcial de (tenant_id, system_key) lo haría fallar si se colara.
--
-- Los nombres deben coincidir con `WAREHOUSES_CATALOG_NAME` y
-- `SERVICES_CATALOG_NAME` (apps/api/src/modules/tenants/role-catalog.ts):
-- la clave es la que el código consulta; el nombre es lo que el usuario lee.
INSERT INTO catalogs (tenant_id, name, system_key, is_system, is_active, created_at, updated_at)
SELECT t.id, 'Catálogo de Almacenes', 'warehouses', true, true, now(), now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM catalogs c
  WHERE c.tenant_id = t.id AND c.system_key = 'warehouses'
);

INSERT INTO catalogs (tenant_id, name, system_key, is_system, is_active, created_at, updated_at)
SELECT t.id, 'Catálogo de Servicios', 'services', true, true, now(), now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM catalogs c
  WHERE c.tenant_id = t.id AND c.system_key = 'services'
);
