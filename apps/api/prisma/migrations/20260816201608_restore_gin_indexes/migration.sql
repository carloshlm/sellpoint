-- F2-DB-04 (corrección): los índices GIN pasan a estar DECLARADOS en
-- `schema.prisma`, no solo escritos a mano acá.
--
-- ── El gotcha que motivó esta migración ──────────────────────────────────
-- `prisma migrate dev` construye una shadow DB replayando las migraciones y
-- la diffea contra `schema.prisma`. Todo índice que exista en la base pero NO
-- esté declarado en el schema le parece basura y genera un `DROP INDEX`.
--
-- Pasó exactamente eso: los tres índices de `products` escritos a mano en
-- `20260816201225_products` sobrevivieron a su propia migración y los borró en
-- silencio la SIGUIENTE (`20260816201333_presentations_and_compositions`), que
-- nació con un bloque DropIndex que nadie pidió. Lo detectó el test de
-- integración de F2-DB-04, que había pasado en verde una hora antes.
--
-- La lección para todo el resto de la Fase 2: un índice que Prisma pueda
-- expresar (GIN con operator class incluido) se DECLARA en el schema. En el
-- SQL a mano solo queda lo que Prisma no sabe representar — extensiones,
-- CHECKs e índices PARCIALES (que sí sobreviven, porque Prisma no los ve como
-- equivalentes a un `@@unique` y no los toca).
--
-- `DROP INDEX IF EXISTS` antes de cada `CREATE`: esta migración tiene que
-- converger tanto sobre una base que ya tiene el índice de `catalog_records`
-- (el que se salvó) como sobre una base recién creada en CI. Sin el DROP, en
-- una base fresca fallaría con "already exists".

DROP INDEX IF EXISTS "catalog_records_attributes_idx";
CREATE INDEX "catalog_records_attributes_idx" ON "catalog_records" USING GIN ("attributes" jsonb_path_ops);

DROP INDEX IF EXISTS "products_sku_idx";
CREATE INDEX "products_sku_idx" ON "products" USING GIN ("sku" gin_trgm_ops);

DROP INDEX IF EXISTS "products_name_idx";
CREATE INDEX "products_name_idx" ON "products" USING GIN ("name" gin_trgm_ops);

DROP INDEX IF EXISTS "products_attributes_idx";
CREATE INDEX "products_attributes_idx" ON "products" USING GIN ("attributes" jsonb_path_ops);

-- Los nombres viejos escritos a mano quedan obsoletos: Prisma nombra estos
-- índices `products_sku_idx` / `products_name_idx`. Se limpian por las dudas
-- (en una base fresca no existen; en la local ya los borró la migración
-- anterior).
DROP INDEX IF EXISTS "products_sku_trgm_idx";
DROP INDEX IF EXISTS "products_name_trgm_idx";
