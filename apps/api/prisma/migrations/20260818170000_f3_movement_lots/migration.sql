-- F3-DB-07 — el movimiento y la línea de traspaso dicen QUÉ LOTE movieron.
--
-- Sin estas columnas, el kardex de un producto con lotes no podría explicar de
-- cuál partida salió cada unidad — que es exactamente para lo que existen los
-- lotes. NULL en los productos que no los manejan: la columna está, el dato no
-- se inventa.
--
-- `transfer_lines` cambia su unique de `(traspaso, producto)` a
-- `(traspaso, producto, lote)`: un traspaso puede mover dos partidas distintas
-- del mismo producto, y cada una viaja con su propia caducidad. Lo que sale del
-- origen entra al destino como el MISMO lote.

-- DropIndex
DROP INDEX "transfer_lines_transfer_id_product_id_key";
-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "location" VARCHAR(64),
ADD COLUMN     "lot_id" UUID;
-- AlterTable
ALTER TABLE "transfer_lines" ADD COLUMN     "lot_id" UUID;
-- CreateIndex
-- DOS índices parciales y no uno solo, por la semántica de NULL: en un unique
-- normal dos NULL se consideran DISTINTOS, así que `(traspaso, producto, NULL)`
-- no colisionaría consigo mismo y un producto SIN lote podría repetirse en el
-- mismo traspaso — la invariante se debilitaría en silencio al agregar la
-- columna. Partidos, dicen la regla tal cual es. (Mismo gotcha que el unique
-- parcial de `barcode` en F2.)
CREATE UNIQUE INDEX "transfer_lines_transfer_id_product_id_key"
  ON "transfer_lines" ("transfer_id", "product_id")
  WHERE "lot_id" IS NULL;

CREATE UNIQUE INDEX "transfer_lines_transfer_id_product_id_lot_id_key"
  ON "transfer_lines" ("transfer_id", "product_id", "lot_id")
  WHERE "lot_id" IS NOT NULL;
-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "product_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "transfer_lines" ADD CONSTRAINT "transfer_lines_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "product_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Si hay lote, hay ubicación
-- ─────────────────────────────────────────────────────────────────────────
--
-- La ubicación PARTE el stock (entra en la PK de `stock_lots`), así que un
-- movimiento que toca un lote tiene que decir de qué ubicación salió o a cuál
-- entró — aunque sea `''`, que significa "sin ubicación". Un `lot_id` con
-- `location NULL` dejaría al ledger sin saber qué fila de `stock_lots` mover, y
-- la invariante contra el total se rompería en silencio.
ALTER TABLE "stock_movements"
  ADD CONSTRAINT "stock_movements_lot_location_check"
  CHECK ("lot_id" IS NULL OR "location" IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────
-- Índice parcial del lote
-- ─────────────────────────────────────────────────────────────────────────
--
-- Parcial porque la enorme mayoría de los movimientos NO tienen lote: un
-- índice completo indexaría millones de NULL para servir consultas que siempre
-- preguntan por un lote concreto (el kardex filtrado por partida, F3-KARDEX-01).
CREATE INDEX "stock_movements_lot_id_idx"
  ON "stock_movements" ("lot_id")
  WHERE "lot_id" IS NOT NULL;
