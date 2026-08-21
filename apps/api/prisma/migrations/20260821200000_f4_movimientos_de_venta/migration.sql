-- F4-SALE-01 — un movimiento de stock pertenece a UNA operación, y ahora hay
-- dos clases de operación.
--
-- ── El problema ─────────────────────────────────────────────────────────
--
-- `stock_movements.document_id` era NOT NULL contra `inventory_documents`, y
-- una VENTA no es un documento de inventario: vive en `sales`, con su propia
-- serie `VTA`. Las tres salidas posibles eran atar la venta a un `SAL`
-- automático (dos folios para un hecho), reusar el folio VTA dentro de
-- `inventory_documents`, o esto.
--
-- ── Lo que se eligió (Carlos, 2026-08-21) ───────────────────────────────
--
-- El movimiento apunta a lo que lo originó: un documento **o** una venta,
-- exactamente uno. Es el mismo CHECK `num_nonnulls(...) = 1` que ya usan
-- `sale_items` y `quote_lines` — el vocabulario del proyecto para "esto o
-- aquello, nunca los dos ni ninguno".
--
-- Lo que compra: un hecho, un folio. El kardex muestra `VTA-000123` y enlaza
-- al ticket, y el listado de SALIDAS queda limpio para lo que fue diseñado —
-- capturar movimientos a mano. Con 200 ventas al día, llenarlo de filas
-- automáticas lo habría vuelto inútil.
--
-- Las filas existentes tienen todas `document_id`, así que el CHECK se cumple
-- desde el primer instante: no hay backfill que hacer.

ALTER TABLE "stock_movements" ALTER COLUMN "document_id" DROP NOT NULL;

ALTER TABLE "stock_movements" ADD COLUMN "sale_id" UUID;

ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_document_xor_sale"
  CHECK (num_nonnulls("document_id", "sale_id") = 1);

-- RESTRICT, como todo lo que apunta al histórico: una venta con movimientos
-- asentados no se borra. Anular una venta NO la borra — genera el reverso con
-- motivo `sale_return` (F4-SALE-03).
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El kardex de un producto filtra por producto y ordena por tiempo, pero la
-- pantalla de la venta pide "los movimientos de ESTA venta" — sin índice sería
-- un scan de la tabla más grande del sistema.
CREATE INDEX "stock_movements_sale_id_idx" ON "stock_movements" ("sale_id");
