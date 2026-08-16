-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_by_warehouse" (
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_by_warehouse_pkey" PRIMARY KEY ("product_id","warehouse_id")
);

-- CreateIndex
CREATE INDEX "warehouses_tenant_id_idx" ON "warehouses"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_name_key" ON "warehouses"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "stock_by_warehouse_tenant_id_idx" ON "stock_by_warehouse"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_by_warehouse_warehouse_id_idx" ON "stock_by_warehouse"("warehouse_id");

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_by_warehouse" ADD CONSTRAINT "stock_by_warehouse_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_by_warehouse" ADD CONSTRAINT "stock_by_warehouse_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_by_warehouse" ADD CONSTRAINT "stock_by_warehouse_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- F2-DB-07: la FK que F1-SCOPE-01 dejó reservada (cierra el backlog S4 de
-- f1-scope). Antes de crearla hay que limpiar filas HUÉRFANAS: hasta esta
-- migración `warehouse_id` era un UUID crudo sin FK, así que puede apuntar a
-- un almacén que no existe — y de hecho apunta, porque el test de integración
-- de F1-SCOPE siembra un UUID fijo inventado.
--
-- Borrarlas es correcto, no una pérdida: un scope hacia un almacén inexistente
-- no otorga acceso a nada. En producción `warehouses` recién nace acá, así que
-- CUALQUIER fila previa es necesariamente huérfana (y no debería haber
-- ninguna: la UI que las crea llega en F2-SCOPE-03).
DELETE FROM "user_warehouse_scopes" s
WHERE NOT EXISTS (SELECT 1 FROM "warehouses" w WHERE w."id" = s."warehouse_id");

-- AddForeignKey
ALTER TABLE "user_warehouse_scopes" ADD CONSTRAINT "user_warehouse_scopes_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- F2-DB-08: stock nunca negativo (Prisma no expresa CHECKs)
-- ─────────────────────────────────────────────────────────────────────────
--
-- Stock negativo no es un estado válido del negocio en ningún momento
-- (ARQUITECTURA § 3.5, validación #4). El guard de verdad vive en el service
-- de F3 con un mensaje claro; este CHECK es la red por si alguna vez se cuela
-- un UPDATE fuera de ese camino — a esa altura el dato ya estaría corrupto y
-- nadie se enteraría hasta el inventario físico.
ALTER TABLE "stock_by_warehouse"
  ADD CONSTRAINT "stock_by_warehouse_quantity_check" CHECK ("quantity" >= 0);
