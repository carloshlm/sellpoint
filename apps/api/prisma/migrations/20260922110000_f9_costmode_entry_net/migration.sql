-- F9-COSTMODE-05/06 — el costo NETO materializado en la línea de la entrada.
--
-- NO es simetría con `purchase_lines.unit_cost_net`: es el CANAL del descuento
-- y del redondeo. El neto de una compra ya trae el descuento de línea
-- ((line_total − tax_amount) / quantity) y viene redondeado una sola vez;
-- si la entrada guardara solo el costo en la base del negocio y el `confirm`
-- rederivara el neto desde ahí, una línea con descuento mandaría al kardex y
-- al promedio ponderado un costo MÁS ALTO que el que se pagó, y cada ida y
-- vuelta bruto⇄neto podría mover un centavo. Con la columna, el puente escribe
-- el neto EXACTO de la compra y el `confirm` lo respeta; en una entrada manual
-- queda NULL hasta confirmar, y ahí se deriva del costo tecleado con el grupo
-- fiscal del producto y el modo del negocio (`tenants.cost_tax_mode`).
--
-- Con el default de todos (`excluded`) vale lo mismo que `unit_cost`: nada
-- cambia de número para ningún negocio. Sin trigger nuevo: el de F3 mira el
-- estado del DOCUMENTO y el `confirm` escribe las líneas antes de sellarlo.
ALTER TABLE "inventory_document_lines"
  ADD COLUMN "unit_cost_net" NUMERIC(14,2);
ALTER TABLE "inventory_document_lines" ADD CONSTRAINT "inventory_document_lines_unit_cost_net_check"
  CHECK ("unit_cost_net" IS NULL OR "unit_cost_net" >= 0);
