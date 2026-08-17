-- Data migration: la presentación base pasa a llamarse como su UNIDAD BASE.
--
-- Hasta hoy se creaba con el nombre fijo "Unidad" (`products.service.ts`), así
-- que un producto medido en gramos mostraba una presentación llamada "Unidad"
-- que en realidad valía 1 gramo. El código ya nace corregido; esto arregla lo
-- que quedó cargado antes, en TODOS los tenants y no solo en el que lo reportó.
--
-- Se toca lo MÍNIMO. Solo las presentaciones que cumplen las cuatro señas de
-- haber sido autocreadas:
--   1. nombre exactamente "Unidad" — si el usuario ya la renombró, es SUYA
--   2. factor 1
--   3. es la predeterminada
--   4. su producto NO se mide en `unit`, donde "Unidad" ya es el nombre correcto
--
-- El idioma sale del usuario más antiguo del tenant (quien registró la cuenta):
-- el nombre de una presentación es un dato editable del negocio, no una
-- etiqueta que la UI traduzca al vuelo, así que hay que elegir uno y que sea
-- el suyo.
UPDATE "product_presentations" AS pp
SET "name" = CASE WHEN owner."locale" = 'en' THEN u."name_en" ELSE u."name_es" END
FROM "products" AS pr
  JOIN "units" AS u ON u."code" = pr."base_unit"
  LEFT JOIN LATERAL (
    SELECT us."locale"
    FROM "users" AS us
    WHERE us."tenant_id" = pr."tenant_id"
    ORDER BY us."created_at" ASC
    LIMIT 1
  ) AS owner ON TRUE
WHERE pp."product_id" = pr."id"
  AND pp."name" = 'Unidad'
  AND pp."factor" = 1
  AND pp."is_default_sale" = TRUE
  AND pr."base_unit" <> 'unit'
  -- `UNIQUE(product_id, name)`: si el producto ya tiene una presentación con
  -- el nombre destino, renombrar reventaría la migración entera por una fila.
  AND NOT EXISTS (
    SELECT 1
    FROM "product_presentations" AS otra
    WHERE otra."product_id" = pp."product_id"
      AND otra."id" <> pp."id"
      AND otra."name" = CASE WHEN owner."locale" = 'en' THEN u."name_en" ELSE u."name_es" END
  );
