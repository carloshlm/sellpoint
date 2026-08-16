-- DropIndex
DROP INDEX "catalog_records_attributes_idx";

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "base_unit" VARCHAR(8) NOT NULL DEFAULT 'unit',
    "is_composite" BOOLEAN NOT NULL DEFAULT false,
    "stock_min" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_base_unit_fkey" FOREIGN KEY ("base_unit") REFERENCES "units"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- F2-DB-04: búsqueda de productos e índice del JSONB (Prisma no los expresa)
-- ─────────────────────────────────────────────────────────────────────────

-- `pg_trgm` para la búsqueda de F2-PROD-02: el usuario tipea "paracet" y tiene
-- que encontrar "Paracetamol 500mg". Se eligió trigramas sobre `tsvector`
-- porque acá se busca por SUBCADENA en strings cortos (SKU y nombre), no por
-- palabras de un texto largo: `tsvector` no matchea prefijos parciales dentro
-- de una palabra, que es justo el caso de uso del mostrador.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "products_sku_trgm_idx"  ON "products" USING GIN ("sku" gin_trgm_ops);
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);

-- Mismo criterio que `catalog_records`: `jsonb_path_ops` porque el único
-- operador que usamos es `@>` (filtros por campo personalizado en la lista).
CREATE INDEX "products_attributes_idx"
  ON "products" USING GIN ("attributes" jsonb_path_ops);
