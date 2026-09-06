-- F4-TAX-08 — el impuesto CONGELADO de la línea de cotización.
--
-- El concepto tiene precio congelado (F4-CONCEPT-06), así que tiene
-- impuesto congelado: lo que se cobra es lo que se cotizó, aunque el
-- negocio cambie sus tasas entre cotizar y cobrar. `tax_group_code` dice
-- QUÉ grupo se aplicó; esta columna guarda CON QUÉ componentes (código,
-- nombre y tasa) para que la venta pueda recalcular el impuesto de la
-- cantidad cobrada (que puede ser menor a la cotizada) sin volver al
-- catálogo. Producto y servicio la llevan también, por uniformidad, pero
-- al cobrar releen el catálogo, igual que releen el precio.
ALTER TABLE "quote_lines" ADD COLUMN "tax_rates" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tax_rates_is_array"
  CHECK (jsonb_typeof("tax_rates") = 'array');
