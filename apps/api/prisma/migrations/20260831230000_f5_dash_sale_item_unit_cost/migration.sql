-- F5-DASH-01: el snapshot de costo en la venta.
--
-- `sale_items` guardaba precio pero no costo: la utilidad de una venta pasada
-- era incalculable. Desde ahora cada línea congela al cobrar el costo promedio
-- ponderado vigente, en la MISMA unidad que unit_price (la presentación).
--
-- Aditiva y NULL a propósito: las ventas existentes no se rellenan — la
-- utilidad se calcula solo sobre ventas con snapshot (decisión de Carlos,
-- 2026-08-31: sin aproximación retroactiva).
ALTER TABLE "sale_items" ADD COLUMN "unit_cost" DECIMAL(14,4);
