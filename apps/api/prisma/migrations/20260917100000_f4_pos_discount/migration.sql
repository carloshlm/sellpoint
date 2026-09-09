-- F4-DISC (2026-09-09): el descuento en caja con PIN de autorización, ADITIVA.
--
-- `tenants.discount_code_hash` guarda el PIN HASHEADO con argon2 (nunca en
-- claro: es una credencial, como la contraseña); `discount_code_set_at` es la
-- seña que ve el Admin («configurado el…»); `discount_max_percent` es el tope
-- por ticket (NULL = sin tope). `sales.discount_reason` es el motivo que el
-- cajero escribe al aplicarlo; el monto ya vivía en `sales.discount`.
-- Cuatro ADD COLUMN en NULL, cero DROP: la API vieja ignora columnas que no lee.
--
-- Deshacer, si hiciera falta:
--   ALTER TABLE "tenants" DROP COLUMN "discount_code_hash", DROP COLUMN "discount_code_set_at", DROP COLUMN "discount_max_percent";
--   ALTER TABLE "sales" DROP COLUMN "discount_reason";
ALTER TABLE "tenants" ADD COLUMN "discount_code_hash" TEXT;
ALTER TABLE "tenants" ADD COLUMN "discount_code_set_at" TIMESTAMPTZ(6);
ALTER TABLE "tenants" ADD COLUMN "discount_max_percent" DECIMAL(5, 2);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_discount_max_percent_check"
  CHECK ("discount_max_percent" IS NULL OR ("discount_max_percent" > 0 AND "discount_max_percent" <= 100));

ALTER TABLE "sales" ADD COLUMN "discount_reason" VARCHAR(200);
