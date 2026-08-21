-- F4-DB-03: los permisos del punto de venta en el catálogo GLOBAL, y su
-- asignación a los roles base que ya existen en cada tenant.
--
-- Mismo patrón que `20260819210500_f3_svc_permissions`: los datos de
-- referencia van en la migración y no en `seed.ts` (que es solo dev/demo),
-- para que lleguen a todos los entornos por el pipeline.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Los usuarios YA logueados no ven estos permisos hasta su próximo
-- `/auth/refresh` (≤ 15 min) o un re-login.
--
-- `pos:view` NO es un permiso nuevo inventado acá: VISTAS §9.3 lo exigía desde
-- el diseño original y **no existía en el catálogo** — un permiso fantasma que
-- la atomización de F4 detectó. Se crea aquí en vez de heredarse el hueco.

INSERT INTO permissions (code, module, description) VALUES
  ('pos:quote', 'pos', 'Generar cotizaciones (sin poder cobrar)'),
  ('pos:view',  'pos', 'Ver el historial de ventas y reimprimir tickets')
ON CONFLICT (code) DO NOTHING;

-- ESPEJO de `resolveRolePermissionCodes()` (modules/tenants/role-catalog.ts),
-- que es la fuente de verdad para los tenants NUEVOS; acá se pone al día a los
-- que ya existen. Si divergen, un tenant viejo y uno nuevo terminan distintos —
-- por eso `role-catalog.spec.ts` fija las cuatro filas.

-- TenantAdmin: todo.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'TenantAdmin'
  AND p.code IN ('pos:quote','pos:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager: los dos. Cotizar y consultar el historial son tarea diaria; lo que
-- NO le cae automáticamente es nada de `pos:*` que reescriba historia.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Manager'
  AND p.code IN ('pos:quote','pos:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- POS_Seller: los dos. Cotiza (mostrador de recepción) y ve su historial para
-- reimprimir un ticket que salió mal.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'POS_Seller'
  AND p.code IN ('pos:quote','pos:view')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer: SOLO `pos:view`. El auditor tiene que poder ver las ventas que vino
-- a auditar — pero no cotizar, que es emitir un documento.
--
-- Ojo: la regla automática del catálogo le da a Viewer todo lo terminado en
-- `:read`, y `pos:view` no termina así. Por eso va explícito acá y en
-- `VIEWER_EXTRA_CODES` del role-catalog: si se agregara solo en un lado, un
-- tenant viejo y uno nuevo quedarían distintos.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer' AND p.code = 'pos:view'
ON CONFLICT (role_id, permission_id) DO NOTHING;
