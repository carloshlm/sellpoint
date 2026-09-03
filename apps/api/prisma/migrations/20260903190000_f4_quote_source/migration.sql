-- F9-CLINIC-16 — el origen de una cotización, en la cabecera.
--
-- Mismo par opaco que ya llevan las líneas (F4-CONCEPT-02): `source_module`
-- dice QUÉ módulo la emitió y `source_ref` A QUÉ documento suyo apunta. El
-- POS los guarda y los devuelve; jamás importa nada del módulo. Sin ellos, el
-- listado de cotizaciones tendría que preguntarle a una tabla médica de dónde
-- salió cada folio — exactamente la dependencia que se quiere evitar.

ALTER TABLE "quotes" ADD COLUMN "source_module" VARCHAR(32);
ALTER TABLE "quotes" ADD COLUMN "source_ref" UUID;

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_source_pair" CHECK (("source_module" IS NULL) = ("source_ref" IS NULL));

CREATE INDEX "quotes_source_idx" ON "quotes" ("tenant_id", "source_module", "source_ref")
  WHERE "source_module" IS NOT NULL;
