-- F3-DB-06 — lotes, caducidad y ubicación: el modelo de DOS NIVELES.
--
-- `stock_by_warehouse` sigue siendo el TOTAL y `stock_lots` es el detalle,
-- **solo** para los productos con `tracks_lots`. Se descartó meter el lote en
-- la PK de `stock_by_warehouse` con un valor por defecto para los que no lo
-- usan: un "00-00-00" en caducidad es un string que miente (no ordena, no
-- alerta), todos los tenants pagarían la granularidad, y el día que uno
-- quisiera lotes tendría miles de filas con el default fantasma que migrar.
--
-- Dos decisiones que el schema codifica:
--
--   · **la caducidad es del LOTE** (`product_lots.expires_at`), no de la fila
--     de stock: el mismo lote en dos almacenes vence el mismo día, y ponerla
--     por almacén permitiría que las dos filas se contradigan;
--   · **la ubicación PARTE el stock** (entra en la PK de `stock_lots`): "hay 5
--     en A-3 y 15 en B-1" son dos filas. NOT NULL DEFAULT '' porque un NULL en
--     una clave primaria no se puede, y '' significa "sin ubicación".
--
-- La invariante `Σ stock_lots == stock_by_warehouse` NO la puede expresar la
-- base: la sostiene el ledger (F3-CORE-05), que mueve las dos tablas en la
-- misma transacción, y la fija un test de propiedad.
--
-- **La RLS va en ESTA migración**, no en una posterior: una tabla no debería
-- existir ni un commit sin aislamiento (lección de F3-DOC-03, donde un test
-- probó que sin RLS un usuario de otro tenant podía tocar datos ajenos).

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "tracks_lots" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "product_lots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "lot_code" VARCHAR(64) NOT NULL,
    "expires_at" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_lots" (
    "lot_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location" VARCHAR(64) NOT NULL DEFAULT '',
    "tenant_id" UUID NOT NULL,
    "quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stock_lots_pkey" PRIMARY KEY ("lot_id","warehouse_id","location")
);

-- CreateIndex
CREATE INDEX "product_lots_tenant_id_product_id_expires_at_idx" ON "product_lots"("tenant_id", "product_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_product_id_lot_code_key" ON "product_lots"("product_id", "lot_code");

-- CreateIndex
CREATE INDEX "stock_lots_tenant_id_idx" ON "stock_lots"("tenant_id");

-- CreateIndex
CREATE INDEX "stock_lots_warehouse_id_idx" ON "stock_lots"("warehouse_id");

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "product_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Saldo por lote nunca negativo
-- ─────────────────────────────────────────────────────────────────────────
--
-- Misma regla que `stock_by_warehouse`: el guard con mensaje claro vive en el
-- ledger, esto es la red por si alguna vez se cuela un UPDATE fuera de ese
-- camino. Un saldo negativo por lote además rompería la invariante contra el
-- total sin que nadie se entere hasta el inventario físico.
ALTER TABLE "stock_lots"
  ADD CONSTRAINT "stock_lots_quantity_check" CHECK ("quantity" >= 0);

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_lots', 'stock_lots']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
