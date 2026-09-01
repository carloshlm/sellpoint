-- Los códigos de lote de los documentos YA ASENTADOS también pasan a
-- mayúsculas (Carlos, 2026-09-01).
--
-- ── Por qué se corrige lo que la migración anterior dejó afuera ─────────
--
-- `20260901143000_normalize_lot_codes` normalizó `product_lots` pero solo
-- tocó las líneas de los BORRADORES, por respeto a la regla de F3-DOC-02:
-- lo confirmado es historia y no se edita. Suena prudente y era un error,
-- porque `inventory_document_lines` **no guarda `lot_id`**: el `lot_code` de
-- texto es la ÚNICA referencia de la línea a su lote. Al renombrar el lote
-- maestro y dejar la línea como estaba, la referencia quedó colgando: el
-- documento dice «st1» y ese lote ya no existe con ese nombre.
--
-- O sea que no se preservó nada — se desincronizó. Esto no reescribe la
-- historia: la vuelve a apuntar a donde siempre apuntó. No cambia una sola
-- cantidad, ni un costo, ni un saldo, ni el lote del que salió la mercancía;
-- cambia cómo se escribe el nombre de ese lote, que es exactamente lo que se
-- unificó.
--
-- ── Por qué hay que apagar el trigger ──────────────────────────────────
--
-- `inventory_document_lines_immutable` rechaza con 42501 cualquier escritura
-- sobre líneas de un documento que no sea borrador, y hace bien: es la
-- barrera que sostiene la auditabilidad del inventario. Una migración de
-- datos es justamente el caso que esa barrera no contempla, así que se apaga
-- para esta tabla, se corrige y se vuelve a encender.
--
-- Todo dentro de la transacción de la migración: si el UPDATE falla, el
-- rollback devuelve el trigger encendido — `DISABLE TRIGGER` es
-- transaccional en Postgres. La aplicación nunca ve la tabla desprotegida.
ALTER TABLE inventory_document_lines DISABLE TRIGGER inventory_document_lines_immutable;

UPDATE inventory_document_lines
   SET lot_code = upper(lot_code)
 WHERE lot_code IS NOT NULL
   AND lot_code <> upper(lot_code);

ALTER TABLE inventory_document_lines ENABLE TRIGGER inventory_document_lines_immutable;
