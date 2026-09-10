-- F9-PLANMOD-02 — los permisos de Compras, Gastos y Proveedores, de una vez.
--
-- Compras (`purchases`, incluido desde el plan Pro) y Gastos (`expenses`,
-- desde Basic) son módulos DE PLAN (plan-modules.ts); Proveedores es core
-- compartido por los dos. Los ocho nacen aquí, antes de que exista el código
-- que los exige, para que `permissions-catalog.spec.ts` los encuentre
-- sembrados cuando lleguen los `@RequirePermissions`.
--
-- Reparto (por las reglas de role-catalog.ts, que esta migración espeja para
-- los tenants ya provisionados): TenantAdmin y Manager reciben los ocho —el
-- `:cancel` de compras y gastos también, como `pos:cancel` no, porque anular
-- un gasto no devuelve dinero a nadie—; Viewer solo los `:read`; el vendedor
-- ninguno.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Quien esté logueado ve el permiso en su próximo refresh (≤ 15 min);
-- al probar a mano, cerrar sesión y volver a entrar.

INSERT INTO permissions (code, module, description) VALUES
  ('purchases:read',   'purchases', 'Ver las compras a proveedores'),
  ('purchases:manage', 'purchases', 'Registrar, editar y confirmar compras'),
  ('purchases:cancel', 'purchases', 'Anular compras'),
  ('expenses:read',    'expenses',  'Ver los gastos del negocio'),
  ('expenses:manage',  'expenses',  'Registrar, editar y pagar gastos y administrar sus categorías'),
  ('expenses:cancel',  'expenses',  'Anular gastos'),
  ('suppliers:read',   'suppliers', 'Ver el catálogo de proveedores'),
  ('suppliers:manage', 'suppliers', 'Dar de alta, editar y retirar proveedores')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('TenantAdmin', 'Admin', 'Manager')
  AND p.code IN (
    'purchases:read', 'purchases:manage', 'purchases:cancel',
    'expenses:read', 'expenses:manage', 'expenses:cancel',
    'suppliers:read', 'suppliers:manage'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'Viewer'
  AND p.code IN ('purchases:read', 'expenses:read', 'suppliers:read')
ON CONFLICT (role_id, permission_id) DO NOTHING;
