-- F10-PRESCODE — el CÓDIGO INTERNO de una presentación (Carlos, 2026-11-23).
--
-- «pero es que si debe poder tener la opción de dar la entrada a por ejemplo
-- la bolsa de 1 Kilo o la Bolsa de 10 Kilos, ya sea por código de barra o
-- código interno». Hasta hoy la presentación solo tenía `barcode`, que exige
-- de 6 a 14 dígitos: una bolsa que el negocio arma y etiqueta él mismo no
-- tenía con qué encontrarse.
--
-- La migración es ADITIVA: una columna que nace vacía y un índice. No toca
-- ninguna fila existente.
--
-- El índice único es PARCIAL por la misma razón que el de `barcode`
-- (20260816201333_presentations_and_compositions): un único normal trataría
-- los NULL como valores y solo dejaría UNA presentación sin código en todo el
-- negocio. Es sensible a mayúsculas a propósito: el API guarda el código ya
-- normalizado (`normalizeCode`: mayúsculas, sin espacios de más), igual que el
-- sku del producto.
--
-- Lo que este índice NO puede cubrir —que el código no repita el sku de un
-- producto ni el código de barras de otra presentación— vive en el API
-- (`catalog-codes.ts`): son columnas de tablas y significados distintos, y un
-- índice no cruza tablas.

ALTER TABLE "product_presentations" ADD COLUMN "code" VARCHAR(64);

CREATE UNIQUE INDEX "product_presentations_tenant_id_code_key"
  ON "product_presentations" ("tenant_id", "code")
  WHERE "code" IS NOT NULL;
