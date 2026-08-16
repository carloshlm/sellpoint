-- DropIndex
DROP INDEX "products_attributes_idx";

-- DropIndex
DROP INDEX "products_name_trgm_idx";

-- DropIndex
DROP INDEX "products_sku_trgm_idx";

-- CreateTable
CREATE TABLE "product_presentations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "is_purchasable" BOOLEAN NOT NULL DEFAULT true,
    "is_sellable" BOOLEAN NOT NULL DEFAULT true,
    "is_default_sale" BOOLEAN NOT NULL DEFAULT false,
    "allow_fractional_input" BOOLEAN NOT NULL,
    "barcode" TEXT,
    "price" DECIMAL(14,2),
    "cost" DECIMAL(14,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_compositions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "parent_product_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL,
    "waste_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_compositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_presentations_tenant_id_idx" ON "product_presentations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_presentations_product_id_name_key" ON "product_presentations"("product_id", "name");

-- CreateIndex
CREATE INDEX "product_compositions_tenant_id_idx" ON "product_compositions"("tenant_id");

-- CreateIndex
CREATE INDEX "product_compositions_component_product_id_idx" ON "product_compositions"("component_product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_compositions_parent_product_id_component_product_id_key" ON "product_compositions"("parent_product_id", "component_product_id");

-- AddForeignKey
ALTER TABLE "product_presentations" ADD CONSTRAINT "product_presentations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_presentations" ADD CONSTRAINT "product_presentations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compositions" ADD CONSTRAINT "product_compositions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compositions" ADD CONSTRAINT "product_compositions_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_compositions" ADD CONSTRAINT "product_compositions_component_product_id_fkey" FOREIGN KEY ("component_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- F2-DB-05 / F2-DB-06: CHECKs e índice parcial (Prisma no los expresa)
-- ─────────────────────────────────────────────────────────────────────────

-- Un factor 0 o negativo haría que el stock convertido diera 0 o negativo en
-- cada compra y venta de esa presentación — corrupción silenciosa del
-- inventario, no un error visible.
ALTER TABLE "product_presentations"
  ADD CONSTRAINT "product_presentations_factor_check" CHECK ("factor" > 0);

-- Código de barras único POR TENANT, pero solo entre los que existen: un
-- @@unique común trataría los NULL como valores y dejaría UN solo producto sin
-- código de barras en todo el negocio. Parcial es la única forma correcta.
CREATE UNIQUE INDEX "product_presentations_tenant_id_barcode_key"
  ON "product_presentations" ("tenant_id", "barcode")
  WHERE "barcode" IS NOT NULL;

-- Cantidad positiva y merma en rango: una merma > 100% significaría que armar
-- el producto consume más de lo que existe, y el cálculo de unidades armables
-- devolvería negativos.
ALTER TABLE "product_compositions"
  ADD CONSTRAINT "product_compositions_quantity_check" CHECK ("quantity" > 0);

ALTER TABLE "product_compositions"
  ADD CONSTRAINT "product_compositions_waste_check"
  CHECK ("waste_percentage" >= 0 AND "waste_percentage" <= 100);

-- Autorreferencia DIRECTA: un producto no puede ser componente de sí mismo.
-- Los ciclos INDIRECTOS (A→B→C→A) no se pueden expresar en un CHECK —
-- necesitan recorrer el grafo — y los detecta el DFS del service (F2-BOM-01).
ALTER TABLE "product_compositions"
  ADD CONSTRAINT "product_compositions_no_self_reference_check"
  CHECK ("parent_product_id" <> "component_product_id");
