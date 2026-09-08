-- F1-ADDR-03 (2026-09-08): la dirección estructurada, ADITIVA.
--
-- `address` sigue siendo la línea 1 y NO se toca; todo lo nuevo nace en NULL
-- para los negocios y almacenes que ya existen. Siete ADD COLUMN, cero DROP,
-- cero ALTER TYPE: la API vieja ignora columnas que no lee, así que este SQL
-- puede desplegarse sin ventana (a diferencia del RENAME de F1-NAME-05).
--
-- Deshacer, si hiciera falta:
--   ALTER TABLE "tenants" DROP COLUMN "address_line2", DROP COLUMN "city", DROP COLUMN "postal_code";
--   ALTER TABLE "warehouses" DROP COLUMN "address_line2", DROP COLUMN "city", DROP COLUMN "region", DROP COLUMN "postal_code";
ALTER TABLE "tenants" ADD COLUMN "address_line2" VARCHAR(120);
ALTER TABLE "tenants" ADD COLUMN "city" VARCHAR(120);
ALTER TABLE "tenants" ADD COLUMN "postal_code" VARCHAR(16);

ALTER TABLE "warehouses" ADD COLUMN "address_line2" VARCHAR(120);
ALTER TABLE "warehouses" ADD COLUMN "city" VARCHAR(120);
ALTER TABLE "warehouses" ADD COLUMN "region" VARCHAR(8);
ALTER TABLE "warehouses" ADD COLUMN "postal_code" VARCHAR(16);
