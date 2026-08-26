-- Renombra los roles iniciales (Carlos, 2026-08-26): TenantAdmin -> Admin y
-- POS_Seller -> Seller. El set queda: Admin, Manager, Seller, Viewer.
--
-- La autorización NO depende de esto (ley de f1-scope: el bypass es por
-- catálogo de permisos, nunca por nombre de rol) — el rename es de cara al
-- usuario. Los tenants nuevos ya nacen con los nombres nuevos (role-catalog).
--
-- La guarda NOT EXISTS respeta el unique(tenant_id, name): si un tenant ya
-- creó su propio rol "Admin" o "Seller", el inicial conserva su nombre viejo
-- en vez de reventar la migración — ese caso raro se resuelve a mano.
-- Idempotente: en la segunda pasada ya no hay filas que matcheen el WHERE.
UPDATE "roles" SET "name" = 'Admin'
WHERE "name" = 'TenantAdmin'
  AND NOT EXISTS (
    SELECT 1 FROM "roles" r2
    WHERE r2."tenant_id" = "roles"."tenant_id" AND r2."name" = 'Admin'
  );

UPDATE "roles" SET "name" = 'Seller'
WHERE "name" = 'POS_Seller'
  AND NOT EXISTS (
    SELECT 1 FROM "roles" r2
    WHERE r2."tenant_id" = "roles"."tenant_id" AND r2."name" = 'Seller'
  );
