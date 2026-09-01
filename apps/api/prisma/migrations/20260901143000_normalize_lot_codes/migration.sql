-- Los códigos de lote existentes pasan a MAYÚSCULAS (Carlos, 2026-09-01).
--
-- ── Por qué es una reparación y no cosmética ────────────────────────────
--
-- `product_lots` tiene `@@unique([product_id, lot_code])`, así que «st1» y
-- «ST1» son DOS lotes del mismo producto. Todo camino al API normaliza el
-- código al entrar (`lotCodeField()` en los DTOs), menos uno que se descubrió
-- hoy: la importación por planilla leía la celda tal cual. Por ahí entraron
-- los lotes en minúsculas que quedan en la base.
--
-- La consecuencia no es de estética: quien hoy teclee «st1» en la pantalla lo
-- manda normalizado como «ST1», el sistema no encuentra el lote «st1» que ya
-- existe y CREA otro. Existencias partidas entre dos lotes que la persona
-- cree que son el mismo, y FEFO ordenándolos por separado.
--
-- ── Mayúsculas y nada más ───────────────────────────────────────────────
--
-- `normalizeLotCode` además barre acentos y símbolos, pero acá se aplica solo
-- `upper()`: es lo que se pidió, es lo que resuelve el stock partido, y una
-- transformación más agresiva podría cambiar un código que alguien tiene
-- impreso en la caja física. El guion sobrevive en ambos casos.
--
-- ── El NOT EXISTS es un cinturón de seguridad ───────────────────────────
--
-- Si un producto tuviera «st1» Y «ST1» a la vez, subir el primero a
-- mayúsculas violaría el índice único y TUMBARÍA EL DEPLOY (las migraciones
-- corren al desplegar). Esas filas se dejan como están: fusionar dos lotes
-- exige mover saldos, movimientos y líneas de traspaso, y eso es una
-- operación de negocio que se decide mirando el caso, no un UPDATE. Hoy no
-- existe ninguna en producción ni en sandbox — verificado antes de escribir
-- esta migración.
UPDATE product_lots pl
   SET lot_code = upper(pl.lot_code)
 WHERE pl.lot_code <> upper(pl.lot_code)
   AND NOT EXISTS (
     SELECT 1
       FROM product_lots otro
      WHERE otro.product_id = pl.product_id
        AND otro.lot_code = upper(pl.lot_code)
        AND otro.id <> pl.id
   );

-- Las líneas de los borradores sin confirmar guardan el código TECLEADO, no
-- el id del lote: si quedaran en minúsculas, al confirmar buscarían «st1» y
-- volverían a crear el lote duplicado que esta migración acaba de unificar.
--
-- **Solo los borradores**, y no por prolijidad: `inventory_document_line_is_immutable()`
-- es un trigger que RECHAZA cualquier UPDATE sobre líneas de un documento ya
-- confirmado o anulado. Sin este filtro la migración explota con 42501 y tumba
-- el deploy — se descubrió corriéndola en local, no en producción. Y el
-- trigger tiene razón: un movimiento asentado es historia y no se reescribe.
UPDATE inventory_document_lines l
   SET lot_code = upper(l.lot_code)
  FROM inventory_documents d
 WHERE d.id = l.document_id
   AND d.status = 'draft'
   AND l.lot_code IS NOT NULL
   AND l.lot_code <> upper(l.lot_code);
