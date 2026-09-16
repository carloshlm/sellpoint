-- F10-LANG-01 — el catálogo global guarda el nombre EN CADA IDIOMA.
--
-- El problema, con nombre y apellido: Carlos escaneó un aceite de oliva en
-- Canadá y la pantalla sugirió «Huile d'olive vierge extra». En la botella, en
-- letras grandes, dice «Extra Virgin Olive Oil».
--
-- La causa no era el código sino el VOLCADO. El CSV de Open Food Facts tiene
-- un solo campo de nombre, `product_name`, que trae el nombre en el idioma de
-- quien cargó el producto — no en el del mercado donde se vende. El volcado
-- JSONL sí publica `product_name_en`, `product_name_fr`, `product_name_es` y
-- `lang`, y de ahí salen estas columnas.
--
-- ── Por qué DOS idiomas y no uno por cada idioma del volcado ─────────────
--
-- SellPointy habla español e inglés: son los dos únicos idiomas en los que una
-- sugerencia puede llegarle al usuario EN SU IDIOMA. El francés, el portugués
-- y los demás no necesitan columna propia — viajan en `product_name` con
-- `name_lang` diciendo cuál es, que es exactamente lo que la pantalla necesita
-- para marcarlo («Nombre en francés» en vez de «Nombre sugerido»). Una
-- columna `name_fr` sería una columna que nadie consulta.
--
-- ── Estas columnas también las llenan los negocios ───────────────────────
--
-- Medido sobre 98 productos canadienses reales: 57 tienen nombre en francés y
-- solo 7 de esos tienen inglés en Open Food Facts. Los otros 47 los va a
-- teclear el negocio que los venda, y ese tecleo llena la casilla VACÍA del
-- idioma (decisión de Carlos, 2026-09-16). La LEY de «solo se inserta» no
-- cambia, se muda de nivel: pasa de la fila a la casilla. Un nombre que ya
-- está escrito no lo pisa nadie, nunca.
ALTER TABLE "global_barcode_catalog"
  ADD COLUMN "name_es"   VARCHAR(300),
  ADD COLUMN "name_en"   VARCHAR(300),
  -- El idioma de `product_name`, en ISO 639-1. NULL en las 953,969 filas que
  -- ya están: el volcado CSV del que salieron no lo decía, y adivinarlo sería
  -- inventar. La pantalla trata «no sé el idioma» como «no lo marco».
  ADD COLUMN "name_lang" CHAR(2);

-- Dos letras minúsculas o nada. Sin catálogo de idiomas: el volcado trae
-- decenas y no vamos a mantener una lista para rechazar un dato que solo se
-- muestra.
ALTER TABLE "global_barcode_catalog"
  ADD CONSTRAINT "global_barcode_catalog_name_lang_check"
    CHECK ("name_lang" IS NULL OR "name_lang" ~ '^[a-z]{2}$');
