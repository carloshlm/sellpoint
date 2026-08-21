-- Dos permisos que vivían SOLO en `seed.ts` y nunca llegaron a producción.
--
-- ── Cómo se descubrió ───────────────────────────────────────────────────
--
-- El e2e de F4-CASHBOX-01 pasó en local y **falló entero en CI con 403**: el
-- TenantAdmin recién registrado no tenía `pos:sell`. En local funcionaba porque
-- la base de desarrollo se había sembrado alguna vez; CI construye la base solo
-- con migraciones, que es exactamente lo que hace producción.
--
-- Al revisar la clase completa —y no solo el caso que falló— aparecieron DOS:
--
--   · `pos:sell`     → sin él, el POS de F4 habría llegado inusable
--   · `reports:read` → sin él, el Viewer (el auditor) no vería ningún reporte
--
-- `seed.ts` es dev/demo: NO corre en el pipeline. Los datos de referencia van
-- en migraciones — la misma regla que ya seguían `20260818160000_f3_permissions`
-- y `20260819210500_f3_svc_permissions`. Estos dos se saltaron la regla desde
-- F1/F2 y nadie lo notó porque ningún endpoint los exigía todavía.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Los usuarios ya logueados no los ven hasta su próximo `/auth/refresh`
-- (≤ 15 min) o un re-login.

INSERT INTO permissions (code, module, description) VALUES
  ('pos:sell',     'pos',     'Operar el punto de venta'),
  ('reports:read', 'reports', 'Ver los reportes del negocio')
ON CONFLICT (code) DO NOTHING;

-- ESPEJO de `resolveRolePermissionCodes()` (modules/tenants/role-catalog.ts),
-- que es la fuente de verdad para los tenants NUEVOS; acá se pone al día a los
-- que ya existen.

-- TenantAdmin: los dos (recibe todo el catálogo).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'TenantAdmin'
  AND p.code IN ('pos:sell','reports:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager: los dos. Ninguno está en `MANAGER_EXCLUDED_CODES`.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Manager'
  AND p.code IN ('pos:sell','reports:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- POS_Seller: SOLO `pos:sell` — está en `POS_SELLER_CODES`. Los reportes no:
-- el mostrador vende, no analiza el negocio.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'POS_Seller' AND p.code = 'pos:sell'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer: SOLO `reports:read` — le cae por la regla del `:read`. Vender no es
-- leer.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer' AND p.code = 'reports:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;
