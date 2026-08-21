-- ─────────────────────────────────────────────────────────────────────────
-- Las presentaciones base que ya decían "Unidad" pasan a decir "Pieza".
-- ─────────────────────────────────────────────────────────────────────────
--
-- El nombre de la presentación base NO se traduce al vuelo: `basePresentationName`
-- lo COPIA a la fila cuando se crea el producto, porque es un dato del tenant y
-- se puede editar como cualquier otro nombre. Muy bien pensado — pero significa
-- que renombrar la unidad no alcanza: los productos creados antes se quedaron
-- con la palabra vieja adentro, y el catálogo quedaría partido en dos ("Unidad
-- ×1" en los viejos, "Pieza ×1" en los nuevos).
--
-- ── Por qué el WHERE es tan específico ──────────────────────────────────
--
-- Ese nombre es EDITABLE, así que un UPDATE amplio pisaría algo que una persona
-- eligió a propósito. Se tocan solo las filas que el sistema generó él mismo y
-- nadie cambió después:
--
--   · `factor = 1`      → es la presentación BASE, no una caja ni un blíster;
--   · `base_unit = 'unit'` → el producto se cuenta en piezas (a un producto en
--     gramos jamás se le generó "Unidad": se le generó "Gramo");
--   · el nombre sigue siendo EXACTAMENTE el que generó el sistema, en el
--     idioma en que se creó.
--
-- Una presentación que alguien renombró a mano no cumple la tercera condición
-- y se queda como está, que es lo correcto: era su decisión, no la nuestra.
UPDATE "product_presentations" p
   SET "name" = CASE p."name" WHEN 'Unidad' THEN 'Pieza' ELSE 'Piece' END
  FROM "products" pr
 WHERE pr."id" = p."product_id"
   AND pr."base_unit" = 'unit'
   AND p."factor" = 1
   AND p."name" IN ('Unidad', 'Unit');
