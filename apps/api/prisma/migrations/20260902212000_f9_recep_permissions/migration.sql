-- F9-RECEP-04 — los permisos del módulo Recepción.
--
-- `reception:read` para mirar el registro de clientes y los turnos;
-- `reception:manage` para dar de alta, editar, eliminar, generar y atender.
--
-- Reparto (por las reglas de role-catalog.ts, que esta migración espeja para
-- los tenants ya provisionados): TenantAdmin y Manager reciben los dos;
-- Viewer solo `:read`. El vendedor (POS_Seller) NO recibe ninguno: su lista
-- es cerrada, y la recepcionista es un rol propio que el negocio arma con
-- roles personalizados, o un Manager.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Quien esté logueado ve el permiso en su próximo refresh (≤ 15 min);
-- al probar a mano, cerrar sesión y volver a entrar.

INSERT INTO permissions (code, module, description) VALUES
  ('reception:read',   'reception', 'Ver el registro de clientes y los turnos'),
  ('reception:manage', 'reception', 'Registrar clientes, generar y atender turnos')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('TenantAdmin', 'Admin', 'Manager')
  AND p.code IN ('reception:read', 'reception:manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer' AND p.code = 'reception:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
