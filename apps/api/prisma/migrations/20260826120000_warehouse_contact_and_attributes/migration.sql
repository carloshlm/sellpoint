-- Contacto estándar del almacén + campos dinámicos (Carlos, 2026-08-26).
--
-- Warehouse gana `phone` (E.164 canónico) y `email` para que el TICKET pinte
-- la dirección y el teléfono del almacén de la operación, con fallback al
-- tenant. Warehouse y Service ganan `attributes` JSONB — el mismo motor de
-- campos dinámicos que products (F2-CAT), con catálogos de sistema propios.
--
-- Los GIN van declarados también en schema.prisma (lección de
-- 20260816201608): jsonb_path_ops indexa `@>`, la query inversa de
-- assertNotReferenced. Sin CHECK de formato para phone/email: la validación
-- vive en el DTO (isE164 / email de zod), mismo criterio que tenants
-- (20260825230000_tenant_phone_e164).
ALTER TABLE "warehouses" ADD COLUMN "phone" VARCHAR(20);
ALTER TABLE "warehouses" ADD COLUMN "email" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "services"   ADD COLUMN "attributes" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "warehouses_attributes_idx" ON "warehouses" USING GIN ("attributes" jsonb_path_ops);
CREATE INDEX "services_attributes_idx"   ON "services"   USING GIN ("attributes" jsonb_path_ops);
