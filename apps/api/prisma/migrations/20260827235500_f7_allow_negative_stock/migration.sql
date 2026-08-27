-- F7-DB-07: el saldo de stock ya puede ser NEGATIVO.
--
-- Basic vende SIN control de inventario (decisión de negocio, Fase 7): la
-- venta asienta el kardex completo y deja el saldo en negativo — ese
-- negativo es exactamente la lista de qué inventariar cuando el cliente suba
-- a un plan con control (el conteo de F3 lo corrige con ajuste explicado).
--
-- La barrera deja de ser ESTRUCTURAL y pasa a ser DE PLAN: quien la impone
-- es StockLedgerService, que valida el saldo dentro de su SELECT FOR UPDATE
-- salvo que el plan del tenant tenga stock_control apagado. Entradas,
-- salidas manuales, traspasos y conteos validan SIEMPRE — solo la venta
-- puede empujar bajo cero, y solo en planes sin control.

ALTER TABLE "stock_by_warehouse" DROP CONSTRAINT "stock_by_warehouse_quantity_check";
ALTER TABLE "stock_lots" DROP CONSTRAINT "stock_lots_quantity_check";
