-- Filas, unidades y servicios al pie del ticket (Carlos, 2026-11-16).
--
-- Un cliente pidió que el ticket diga cuántas filas y cuántas piezas lleva.
-- Es una opción de la configuración del ticket y viene APAGADA: los tickets
-- de hoy no cambian hasta que el negocio la prenda. Solo agrega la columna;
-- ninguna fila existente cambia de valor.
ALTER TABLE "ticket_settings" ADD COLUMN "show_item_counts" BOOLEAN NOT NULL DEFAULT false;
