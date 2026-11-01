-- Un renglón de impuesto POR TASA (Carlos, 2026-11-01).
--
-- Los grupos de IVA de México (16, 8 y 0%) —y los de otros países— comparten
-- el componente `VAT`. El motor de totales juntaba por código y una venta que
-- mezclaba 0% y 16% guardaba UN renglón con el nombre y la tasa del primero y
-- la suma de los dos («IVA 0% $17.24»). Ahora es un renglón por (componente,
-- tasa), así que la unicidad pasa de (documento, código) a (documento, código,
-- tasa). Relaja la regla: todo lo que ya está guardado la cumple.

DROP INDEX "sale_taxes_sale_id_code_key";
CREATE UNIQUE INDEX "sale_taxes_sale_id_code_rate_key" ON "sale_taxes"("sale_id", "code", "rate");

DROP INDEX "quote_taxes_quote_id_code_key";
CREATE UNIQUE INDEX "quote_taxes_quote_id_code_rate_key" ON "quote_taxes"("quote_id", "code", "rate");

DROP INDEX "purchase_taxes_purchase_id_code_key";
CREATE UNIQUE INDEX "purchase_taxes_purchase_id_code_rate_key" ON "purchase_taxes"("purchase_id", "code", "rate");

DROP INDEX "purchase_order_taxes_purchase_order_id_code_key";
CREATE UNIQUE INDEX "purchase_order_taxes_purchase_order_id_code_rate_key" ON "purchase_order_taxes"("purchase_order_id", "code", "rate");
