-- F4-POSVIS: «Mostrar existencias en el punto de venta» es CONFIGURACIÓN del
-- negocio (Carlos, 2026-09-04) y responde una pregunta distinta de «Vender
-- sin existencias»: aquella decide si se PUEDE cobrar de más; esta, si el
-- vendedor VE cuánto hay. Apagada, el API no manda la existencia al punto de
-- venta (búsqueda, escáner y carga de cotización): ni «N disponibles», ni
-- «más de lo que hay», ni «faltan N». La regla del cobro no cambia.
-- Encendida por defecto: ningún negocio actual nota el cambio.
ALTER TABLE "tenants" ADD COLUMN "pos_shows_stock" BOOLEAN NOT NULL DEFAULT true;
