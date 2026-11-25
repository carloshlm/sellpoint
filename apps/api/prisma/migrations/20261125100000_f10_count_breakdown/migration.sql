-- F10-BULK-11 — el DESGLOSE de un renglón del inventario físico (2026-11-25).
--
-- El conteo sigue en unidad base (decisión del 2026-08-31): `counted` es lo
-- que se asienta. Esta columna guarda la cuenta que lo explica, «Contar por
-- presentaciones»: `[{ "presentationId": "<uuid>" | null, "quantity": "2" }]`,
-- donde `null` son los sueltos en unidad base. Sin ella, corregir una bolsa
-- obligaba a teclear todo otra vez y el conteo confirmado no decía cómo se
-- contó.
--
-- El API valida el desglose y CALCULA `counted` desde él (suma de cantidad ×
-- factor); por eso aquí no hay CHECK de forma: la regla vive en un solo lugar.
--
-- La migración es ADITIVA: una columna opcional que nace vacía. No toca
-- ninguna fila existente, y un renglón sin desglose funciona como siempre.

ALTER TABLE "inventory_document_lines" ADD COLUMN "count_breakdown" JSONB;
