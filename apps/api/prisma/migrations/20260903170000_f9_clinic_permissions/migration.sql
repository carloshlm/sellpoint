-- F9-CLINIC-05 — los permisos del Consultorio Médico.
--
-- `medical_clinic:read` mira los catálogos de estudios; `medical_clinic:manage`
-- los administra; `medical_clinic:attend` abre y captura expedientes y
-- órdenes. Tres y no dos a propósito: la recepcionista registra pacientes y
-- consulta precios sin poder LEER una historia clínica.
--
-- Reparto (por las reglas de role-catalog.ts, que esta migración espeja para
-- los tenants ya provisionados): TenantAdmin y Manager reciben los tres —el
-- médico suele ser Manager; la privacidad estricta se arma con un rol
-- personalizado «Médico»—; Viewer solo `:read`; el vendedor ninguno.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Quien esté logueado ve el permiso en su próximo refresh (≤ 15 min);
-- al probar a mano, cerrar sesión y volver a entrar.

INSERT INTO permissions (code, module, description) VALUES
  ('medical_clinic:read',   'medical_clinic', 'Ver los catálogos de estudios del consultorio'),
  ('medical_clinic:manage', 'medical_clinic', 'Administrar los catálogos de estudios del consultorio'),
  ('medical_clinic:attend', 'medical_clinic', 'Atender pacientes: abrir y capturar historias clínicas y órdenes')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('TenantAdmin', 'Admin', 'Manager')
  AND p.code IN ('medical_clinic:read', 'medical_clinic:manage', 'medical_clinic:attend')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer' AND p.code = 'medical_clinic:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
