-- Backfill del catálogo del sistema "suppliers" (F9-SUPPCAT-05, Carlos
-- 2026-09-12: «el catálogo de Proveedores también debe poder ser
-- personalizable y poder agregar campos como lo haces con Almacenes,
-- Productos y Servicios») para los tenants que YA existen.
--
-- Desde hoy, `TenantsService.provision()` crea los cuatro catálogos del
-- sistema junto con el tenant. Los registrados antes nacieron con tres — sin
-- este no podrían definir campos propios de proveedores. `suppliers.attributes`
-- existe desde el alta de la tabla (JSONB + GIN) y nadie lo usaba: este
-- catálogo es lo que le da sentido.
--
-- Idempotente por partida doble: el `NOT EXISTS` evita duplicar y el índice
-- único parcial de (tenant_id, system_key) lo haría fallar si se colara.
-- El nombre debe coincidir con `SUPPLIERS_CATALOG_NAME` (role-catalog.ts).
INSERT INTO catalogs (tenant_id, name, system_key, is_system, is_active, created_at, updated_at)
SELECT t.id, 'Catálogo de Proveedores', 'suppliers', true, true, now(), now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM catalogs c
  WHERE c.tenant_id = t.id AND c.system_key = 'suppliers'
);
