-- F9-PURCH-03 — el PUENTE: de dónde nació una entrada de inventario.
--
-- Mismo par opaco que ya llevan las cotizaciones (`quotes.source_module` /
-- `source_ref`, F4-QUOTE-03) y las líneas de venta (F4-CONCEPT-02): dos
-- columnas que el core NO interpreta. El inventario no sabe qué es
-- «purchases»; lo guarda, lo devuelve y lo pinta. **Sin FK a propósito**: una
-- FK del core hacia la tabla de un módulo de plan invertiría la dependencia
-- —el inventario existe en negocios que no tienen Compras— y ataría el
-- borrado de una tabla del módulo al core.
--
-- ── El índice único y el callejón de SAL-000002 ─────────────────────────
--
-- Una compra confirmada ofrece UNA entrada, no una por clic: el índice hace
-- la idempotencia en la BASE, no en un `if` del service que dos pestañas
-- pueden cruzar. Y lleva `status <> 'canceled'` porque una entrada ANULADA es
-- historia, no el documento con el que se recibió: sin esa condición, anular
-- el borrador dejaba la compra apuntando para siempre a un documento muerto y
-- el único impedía abrir otro — la mercancía quedaba sin forma de entrar.
-- Carlos lo pisó con SAL-000002 en los traspasos; acá nace corregido.

ALTER TABLE "inventory_documents" ADD COLUMN "source_module" VARCHAR(32);
ALTER TABLE "inventory_documents" ADD COLUMN "source_ref" UUID;

ALTER TABLE "inventory_documents"
  ADD CONSTRAINT "inventory_documents_source_pair"
  CHECK (("source_module" IS NULL) = ("source_ref" IS NULL));

CREATE UNIQUE INDEX "inventory_documents_source_alive_key"
  ON "inventory_documents" ("source_module", "source_ref")
  WHERE "source_ref" IS NOT NULL AND "status" <> 'canceled';

CREATE INDEX "inventory_documents_source_idx"
  ON "inventory_documents" ("tenant_id", "source_module", "source_ref")
  WHERE "source_module" IS NOT NULL;
