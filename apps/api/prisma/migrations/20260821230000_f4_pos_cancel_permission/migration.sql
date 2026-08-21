-- F4-SALE-03 — anular una venta es decisión de GESTIÓN, no de mostrador.
--
-- El tablero lo pedía como «TenantAdmin/Manager — el cajero NO anula» sin
-- nombrar un permiso. Se resuelve con uno propio y no con un `if` sobre el
-- rol: los roles de este sistema son configurables (un tenant puede crear el
-- suyo), así que la regla tiene que viajar en el CATÁLOGO de permisos, no en
-- una lista de nombres de rol dentro del código.
--
-- Que quede FUERA de `POS_SELLER_CODES` es lo que produce el reparto pedido:
-- TenantAdmin y Manager lo reciben por las reglas que ya existen, el cajero no.
--
-- Mismo criterio que `inventory:manage` en F3: mover mercancía es tarea
-- diaria; deshacer una operación asentada, no.
--
-- ⚠ GOTCHA CONOCIDO: una migración SQL no puede bumpear el `perm-epoch` de
-- Redis. Los usuarios ya logueados lo ven en su próximo refresh (≤ 15 min).

INSERT INTO permissions (code, module, description) VALUES
  ('pos:cancel', 'pos', 'Anular una venta ya cobrada')
ON CONFLICT (code) DO NOTHING;

-- TenantAdmin y Manager. POS_Seller NO: es justamente el punto.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('TenantAdmin', 'Manager') AND p.code = 'pos:cancel'
ON CONFLICT (role_id, permission_id) DO NOTHING;
