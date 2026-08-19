-- F3-SVC-02: permisos del catálogo de Servicios en el catálogo GLOBAL, y su
-- asignación a los roles base que ya existen en cada tenant.
--
-- Mismo patrón que `20260818160000_f3_permissions`: los datos de referencia van
-- en la migración y no en `seed.ts` (que es solo dev/demo), para que lleguen a
-- todos los entornos por el pipeline.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Los usuarios YA logueados no ven estos permisos hasta su próximo
-- `/auth/refresh` (≤ 15 min) o un re-login.

INSERT INTO permissions (code, module, description) VALUES
  ('services:read',   'services', 'Ver el catálogo de servicios'),
  ('services:manage', 'services', 'Crear, editar, desactivar y eliminar servicios')
ON CONFLICT (code) DO NOTHING;

-- ESPEJO de `resolveRolePermissionCodes()` (modules/tenants/role-catalog.ts),
-- que es la fuente de verdad para los tenants NUEVOS; acá se pone al día a los
-- que ya existen. Si divergen, un tenant viejo y uno nuevo terminan distintos —
-- por eso `role-catalog.spec.ts` fija las cuatro filas.

-- TenantAdmin: los dos.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'TenantAdmin'
  AND p.code IN ('services:read','services:manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager: los dos también. A diferencia de `inventory:manage`, dar de alta un
-- servicio o cambiarle el precio es tarea diaria y no reescribe historia.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Manager'
  AND p.code IN ('services:read','services:manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer: solo lectura (regla implícita: todo code `:read` le cae).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer' AND p.code = 'services:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- POS_Seller: LEE, y esta es la diferencia con los permisos de inventario. El
-- POS de F4 vende servicios además de mercancía; sin el catálogo no hay qué
-- vender. Administrarlos NO: cambiar un precio no es tarea de mostrador.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'POS_Seller' AND p.code = 'services:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
