-- El interruptor de UBICACIONES del negocio (Carlos, 2026-08-30).
--
-- Apagado por defecto: un negocio que no ordena su almacén por pasillos no
-- tiene por qué ver un campo más en cada alta de producto. Encendido, la
-- ficha muestra "Ubicación" y la hoja del inventario físico se ordena por
-- recorrido en vez de por código.
--
-- Es de NEGOCIO y no de plan: cobrar por un campo de texto sería débil, y
-- quien contrata el plan más chico para su mostrador es justo quien más
-- necesita acordarse de dónde dejó las cosas. Mismo criterio que
-- `sell_without_stock`.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS uses_locations BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenants.uses_locations IS
  'Muestra el campo Ubicación en los productos y ordena la hoja del conteo por recorrido. No lleva saldo por ubicación: eso vive en stock_lots.';
