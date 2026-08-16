-- F2-CAT-01: backfill del Catálogo de Productos para los tenants que YA
-- existen.
--
-- Desde esta fase, `TenantsService.provision()` lo crea junto con el tenant.
-- Pero los tenants registrados ANTES de F2 nacieron sin él, y un tenant sin
-- catálogo de productos no puede dar de alta un producto ni definir campos —
-- quedaría roto sin ningún error visible hasta que alguien intente usarlo.
--
-- Idempotente por partida doble: el `NOT EXISTS` evita duplicar y el índice
-- único parcial de (tenant_id, system_key) lo haría fallar si se colara. Se
-- puede correr dos veces sin consecuencias.
--
-- El nombre debe coincidir con `PRODUCTS_CATALOG_NAME`
-- (apps/api/src/modules/tenants/role-catalog.ts) para que un tenant viejo y
-- uno nuevo se vean iguales. La clave `products` es la que el código consulta;
-- el nombre es solo lo que el usuario lee y puede cambiar.
INSERT INTO catalogs (tenant_id, name, system_key, is_system, is_active, created_at, updated_at)
SELECT t.id, 'Catálogo de Productos', 'products', true, true, now(), now()
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM catalogs c
  WHERE c.tenant_id = t.id AND c.system_key = 'products'
);
