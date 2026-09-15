-- F9-PLANLIST-01 — «Órdenes de compra y recepciones parciales» es de Plus.
--
-- Carlos (2026-09-15) cerró la lista comercial: Compras (el módulo, desde
-- Pro) es la compra directa con factura; planear con órdenes al proveedor y
-- recibir en partes es el escalón de Plus. Hasta hoy las órdenes viajaban
-- dentro del módulo, sin flag propio, así que un Pro las tenía completas.
--
-- `||` fusiona sobre el JSONB y conserva las otras diez keys de la matriz,
-- que `planFeaturesSchema` valida como `strictObject` al leer la fila: sin
-- esta migración, leer cualquier plan revienta — a propósito.
UPDATE plans
SET features   = features || '{"purchase_orders": false}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('free', 'basic', 'pro');

UPDATE plans
SET features   = features || '{"purchase_orders": true}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE code IN ('plus', 'premium');

-- La descripción de Plus nombra lo que ahora lo distingue. El web la
-- traduce; esta es la de respaldo, en español.
UPDATE plans
SET description = 'Lotes y caducidades, órdenes de compra y personalización profunda',
    updated_at  = CURRENT_TIMESTAMP
WHERE code = 'plus';
