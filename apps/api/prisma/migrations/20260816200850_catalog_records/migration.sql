-- CreateTable
CREATE TABLE "catalog_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "catalog_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "catalog_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "catalog_records_tenant_id_idx" ON "catalog_records"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_records_catalog_id_code_key" ON "catalog_records"("catalog_id", "code");

-- AddForeignKey
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_catalog_id_fkey" FOREIGN KEY ("catalog_id") REFERENCES "catalogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- F2-DB-03: índice GIN sobre `attributes` (Prisma no lo expresa)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Lo necesitan dos caminos calientes del motor:
--  1. La query INVERSA de integridad de lookups: antes de archivar un registro
--     hay que saber si alguien lo referencia (`attributes @> {"<key>":"<id>"}`).
--     Sin GIN eso es un seq scan sobre todo el catálogo en cada archivado.
--  2. Los filtros por campo personalizado en las listas de subcatálogos.
--
-- `jsonb_path_ops` en vez del default: la mitad de tamaño y más rápido para el
-- operador `@>`, que es exactamente el único que usamos. El precio es no
-- soportar `?`/`?|`/`?&` (existencia de clave), que no usamos.
CREATE INDEX "catalog_records_attributes_idx"
  ON "catalog_records" USING GIN ("attributes" jsonb_path_ops);
