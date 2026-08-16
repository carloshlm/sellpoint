-- F2-DB-10: permisos de Fase 2 en el catálogo GLOBAL, y su asignación a los
-- roles base que ya existen en cada tenant.
--
-- Los datos de referencia van en la migración, no en `seed.ts` (que es solo
-- dev/demo), para que lleguen a todos los entornos por el pipeline — mismo
-- patrón que `20260812143000_seed_permissions_catalog` y
-- `20260815021155_tenants_manage_permission`.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Los usuarios YA logueados no van a ver estos permisos hasta su
-- próximo `/auth/refresh` (≤ 15 min) o un re-login. No es un bug: es la
-- consecuencia de que el epoch viva en Redis y la migración corra en la DB.

INSERT INTO permissions (code, module, description) VALUES
  ('catalogs:read',     'catalogs',   'Ver catálogos y sus registros'),
  ('catalogs:write',    'catalogs',   'Crear y editar registros de los catálogos'),
  ('catalogs:manage',   'catalogs',   'Definir la estructura: catálogos y campos'),
  ('products:read',     'products',   'Ver el catálogo de productos'),
  ('products:manage',   'products',   'Crear y editar productos, presentaciones y composición'),
  ('warehouses:read',   'warehouses', 'Ver almacenes'),
  ('warehouses:manage', 'warehouses', 'Crear, editar y desactivar almacenes')
ON CONFLICT (code) DO NOTHING;

-- Asignación a los roles base. Este SQL es el ESPEJO de
-- `resolveRolePermissionCodes()` (apps/api/src/modules/tenants/role-catalog.ts),
-- que es la fuente de verdad para los tenants NUEVOS; acá se pone al día a los
-- que ya existen. Si las dos divergen, un tenant viejo y uno nuevo terminan con
-- permisos distintos — por eso el test de `role-catalog` fija las reglas.

-- TenantAdmin: todo.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'TenantAdmin'
  AND p.code IN ('catalogs:read','catalogs:write','catalogs:manage',
                 'products:read','products:manage',
                 'warehouses:read','warehouses:manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager: todo MENOS `catalogs:manage` (no rediseña el molde del catálogo).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Manager'
  AND p.code IN ('catalogs:read','catalogs:write',
                 'products:read','products:manage',
                 'warehouses:read','warehouses:manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- POS_Seller: solo ver productos (ya lo esperaba `POS_SELLER_CODES`).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'POS_Seller' AND p.code = 'products:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer: los `:read`, por la misma regla que ya aplica el resolver.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer'
  AND p.code IN ('catalogs:read','products:read','warehouses:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;
