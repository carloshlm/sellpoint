-- F3-DB-05: permisos de Fase 3 en el catálogo GLOBAL, y su asignación a los
-- roles base que ya existen en cada tenant.
--
-- Los datos de referencia van en la migración, no en `seed.ts` (que es solo
-- dev/demo), para que lleguen a todos los entornos por el pipeline — mismo
-- patrón que `20260816202800_f2_permissions`.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Los usuarios YA logueados no van a ver estos permisos hasta su
-- próximo `/auth/refresh` (≤ 15 min) o un re-login. No es un bug: es la
-- consecuencia de que el epoch viva en Redis y la migración corra en la DB.

INSERT INTO permissions (code, module, description) VALUES
  ('inventory:read',     'inventory', 'Ver kardex, existencias, traspasos y documentos de inventario'),
  ('inventory:movement', 'inventory', 'Registrar y confirmar entradas, salidas y traspasos'),
  ('inventory:manage',   'inventory', 'Cancelar traspasos y aprobar inventarios físicos')
ON CONFLICT (code) DO NOTHING;

-- Asignación a los roles base. Este SQL es el ESPEJO de
-- `resolveRolePermissionCodes()` (apps/api/src/modules/tenants/role-catalog.ts),
-- que es la fuente de verdad para los tenants NUEVOS; acá se pone al día a los
-- que ya existen. Si las dos divergen, un tenant viejo y uno nuevo terminan con
-- permisos distintos — por eso `role-catalog.spec.ts` fija las cuatro filas.

-- TenantAdmin: los tres.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'TenantAdmin'
  AND p.code IN ('inventory:read','inventory:movement','inventory:manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Manager: mueve mercancía, pero NO cancela traspasos ni aprueba conteos.
-- Las dos operaciones que quedan afuera comparten una propiedad: no se
-- deshacen solas. Cancelar un traspaso deja el stock fuera del origen para
-- siempre (el reingreso es un ajuste explícito), y aprobar un conteo reescribe
-- el saldo contra lo que alguien contó a mano.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Manager'
  AND p.code IN ('inventory:read','inventory:movement')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer: solo lectura (regla implícita de `resolveRolePermissionCodes`: todo
-- code terminado en `:read` le cae).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer' AND p.code = 'inventory:read'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- POS_Seller NO recibe ninguno a propósito: `POS_SELLER_CODES` es un set
-- explícito y F4 decidirá qué necesita el punto de venta. Un vendedor no
-- registra entradas de almacén.
