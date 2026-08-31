-- La UBICACIÓN de referencia del producto: dónde suele estar en el almacén
-- (pasillo, estante, rack).
--
-- Decisión de Carlos (2026-08-30), y la parte importante es lo que NO es:
-- **no parte el saldo**. Llevar existencias POR ubicación es lo que hacen los
-- lotes —`stock_lots` tiene clave (lote, almacén, ubicación)— y convertiría
-- cada venta en la pregunta "¿de qué estante lo saco?". Un negocio que no
-- sostiene esa disciplina termina con saldos por ubicación desincronizados en
-- una semana: basura con apariencia de precisión.
--
-- Esto es un dato de REFERENCIA para dos cosas concretas: encontrar el
-- producto, y ordenar la hoja del inventario físico por recorrido del
-- almacén en vez de por SKU — que es lo que convierte un conteo de 300
-- líneas en un paseo de ida y no en un zigzag.
ALTER TABLE products ADD COLUMN IF NOT EXISTS location VARCHAR(64);

COMMENT ON COLUMN products.location IS
  'Ubicación de referencia (pasillo/estante). NO parte el saldo: el stock por ubicación vive en stock_lots.';
