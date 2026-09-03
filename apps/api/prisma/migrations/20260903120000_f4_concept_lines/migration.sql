-- F4-CONCEPT-02 — la línea de CONCEPTO en cotización y venta (2026-09-03).
--
-- Lo que no está en ningún catálogo del POS —un flete, un anticipo, un
-- estudio de laboratorio que emite un módulo vertical— se cotiza como
-- concepto: descripción + precio, sin stock ni ledger. Para que la forma de
-- la línea siga cerrada, el XOR producto/servicio se REEMPLAZA por un CHECK
-- de forma por `kind`: cada tipo dice exactamente qué columnas lleva. No se
-- relaja a «a lo sumo una referencia»: eso reabriría la línea «de nada» que
-- el XOR cerró en F4.
--
-- `kind` es VARCHAR + CHECK y no un enum de Postgres (mismo criterio que
-- `reception_turns.status`): un cuarto tipo no exige ALTER TYPE. La lista
-- canónica es `POS_LINE_KINDS` en packages/shared.
--
-- `concept_description` solo existe en `sale_items`: `quote_lines` ya tiene
-- `description` para toda línea (el papel que se llevó el cliente), y la
-- venta nunca tuvo texto porque el ticket lo resuelve del catálogo. Un
-- concepto no tiene catálogo que leer, así que su texto vive en la fila — y
-- SOLO en la suya: un producto con descripción de concepto rebota.
--
-- `source_module` + `source_ref` son dos strings OPACOS: el POS guarda de
-- dónde salió la línea (módulo + id) y los devuelve; jamás importa nada del
-- módulo. Van en par o no van.

-- ─────────────────────────────────────────────────────────────────────────
-- quote_lines
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "quote_lines"
  ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'product',
  ADD COLUMN "source_module" VARCHAR(32),
  ADD COLUMN "source_ref" UUID;

-- Backfill: las filas viejas dicen lo que siempre fueron.
UPDATE "quote_lines" SET "kind" = 'service' WHERE "service_id" IS NOT NULL;

ALTER TABLE "quote_lines" DROP CONSTRAINT "quote_lines_product_xor_service";
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_kind_shape" CHECK (
  ("kind" = 'product' AND "product_id" IS NOT NULL AND "service_id" IS NULL)
  OR ("kind" = 'service' AND "service_id" IS NOT NULL AND "product_id" IS NULL)
  OR ("kind" = 'concept' AND "product_id" IS NULL AND "service_id" IS NULL AND "presentation_id" IS NULL)
);
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_source_pair"
  CHECK (("source_module" IS NULL) = ("source_ref" IS NULL));

CREATE INDEX "quote_lines_source_idx" ON "quote_lines"("tenant_id", "source_module", "source_ref")
  WHERE "source_module" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- sale_items
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "sale_items"
  ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'product',
  ADD COLUMN "concept_description" TEXT,
  ADD COLUMN "source_module" VARCHAR(32),
  ADD COLUMN "source_ref" UUID;

UPDATE "sale_items" SET "kind" = 'service' WHERE "service_id" IS NOT NULL;

ALTER TABLE "sale_items" DROP CONSTRAINT "sale_items_product_xor_service";
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_kind_shape" CHECK (
  ("kind" = 'product' AND "product_id" IS NOT NULL AND "service_id" IS NULL AND "concept_description" IS NULL)
  OR ("kind" = 'service' AND "service_id" IS NOT NULL AND "product_id" IS NULL AND "concept_description" IS NULL)
  OR ("kind" = 'concept' AND "product_id" IS NULL AND "service_id" IS NULL
      AND "presentation_id" IS NULL AND "concept_description" IS NOT NULL)
);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_source_pair"
  CHECK (("source_module" IS NULL) = ("source_ref" IS NULL));

CREATE INDEX "sale_items_source_idx" ON "sale_items"("tenant_id", "source_module", "source_ref")
  WHERE "source_module" IS NOT NULL;
