-- F1-WEB-ONBOARD-01 (D4 del design): permiso NUEVO `tenants:manage` + grant a
-- TenantAdmin de TODOS los tenants YA EN PRODUCCIÓN. Mismo patrón que
-- 20260812143000_seed_permissions_catalog: ON CONFLICT DO NOTHING la hace
-- idempotente, corre segura sin importar cuántas veces se aplique.
--
-- Gotcha aceptado (design A7): los permisos viajan EN el JWT
-- (`resolvePermissionCodes`), y una migración SQL no puede bumpear
-- `perm-epoch` en Redis. Los TenantAdmin YA LOGUEADOS no ven el permiso
-- nuevo hasta su próximo `/auth/refresh` (≤ TTL del access token).
INSERT INTO permissions (code, module, description) VALUES
  ('tenants:manage', 'tenants', 'Configurar el perfil del negocio (razón social, dirección, moneda, onboarding)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'TenantAdmin' AND p.code = 'tenants:manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
