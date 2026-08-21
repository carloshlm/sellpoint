-- F4-DB-02 — La cotización: una lista con folio, no una operación.
--
-- Adelantada de F9 a F4 (Carlos, 2026-08-20). Tres decisiones suyas se ven en
-- lo que estas tablas NO tienen: sin `valid_until` ni estado `expired` (no
-- maneja vigencia — los precios son de REFERENCIA y el POS los recalcula al
-- cargarla, así que no hay promesa que pueda vencer), sin `customer_id` (los
-- clientes llegan en su fase) y **sin una sola FK al ledger**: cotizar no mueve
-- stock, y que sea imposible referenciar un movimiento desde acá es la forma
-- estructural de decirlo.

CREATE TYPE "QuoteStatus" AS ENUM ('open', 'loaded', 'canceled');

CREATE TABLE "quotes" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"    UUID NOT NULL,
    "folio"        VARCHAR(32) NOT NULL,
    -- El almacén del COTIZADOR. No exige turno —cotizar no toca dinero— y no
    -- es necesariamente el que manda al cobrar: ese es el del TURNO.
    "warehouse_id" UUID NOT NULL,
    "status"       "QuoteStatus" NOT NULL DEFAULT 'open',
    "total"        DECIMAL(14,2) NOT NULL,
    "note"         TEXT,
    "created_by"   UUID NOT NULL,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "loaded_at"    TIMESTAMPTZ(6),
    "canceled_by"  UUID,
    "canceled_at"  TIMESTAMPTZ(6),

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_canceled_coherent"
  CHECK (("canceled_by" IS NULL) = ("canceled_at" IS NULL));

-- Cada estado con su marca de tiempo, y sin las de los otros. Un `open` con
-- fecha de carga es un dato que no se puede explicar.
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_status_coherent"
  CHECK (
    ("status" = 'open'     AND "loaded_at" IS NULL     AND "canceled_at" IS NULL)
    OR ("status" = 'loaded'   AND "loaded_at" IS NOT NULL AND "canceled_at" IS NULL)
    OR ("status" = 'canceled' AND "canceled_at" IS NOT NULL AND "loaded_at" IS NULL)
  );

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_total_non_negative" CHECK ("total" >= 0);

CREATE UNIQUE INDEX "quotes_tenant_id_folio_key" ON "quotes" ("tenant_id", "folio");
CREATE INDEX "quotes_tenant_created_idx" ON "quotes" ("tenant_id", "created_at" DESC);
CREATE INDEX "quotes_tenant_status_idx" ON "quotes" ("tenant_id", "status");

ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- quote_lines — el MISMO shape que `sale_items`, a propósito
--
-- Que se parezcan tanto es lo que hace que volcar una cotización al carrito
-- sea un mapeo directo y no una traducción. La diferencia está en lo que
-- significa `unit_price`: acá es de REFERENCIA y `for-sale` lo descarta.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "quote_lines" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"       UUID NOT NULL,
    "quote_id"        UUID NOT NULL,
    "line_no"         INTEGER NOT NULL,
    "product_id"      UUID,
    "service_id"      UUID,
    "presentation_id" UUID,
    -- Lo cotizado, en texto: sobrevive a que el producto se borre o cambie de
    -- nombre. El papel que el cliente se llevó decía ESTO.
    "description"     TEXT NOT NULL,
    "quantity"        DECIMAL(14,4) NOT NULL,
    "unit_price"      DECIMAL(14,2) NOT NULL,
    "line_total"      DECIMAL(14,2) NOT NULL,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "quote_lines_pkey" PRIMARY KEY ("id")
);

-- El mismo CHECK que en `sale_items`: un producto O un servicio, nunca los dos
-- ni ninguno.
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_xor_service"
  CHECK (num_nonnulls("product_id", "service_id") = 1);

ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_presentation_only_for_products"
  CHECK ("presentation_id" IS NULL OR "product_id" IS NOT NULL);

ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quantity_positive"
  CHECK ("quantity" > 0);
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_amounts_non_negative"
  CHECK ("unit_price" >= 0 AND "line_total" >= 0);

CREATE UNIQUE INDEX "quote_lines_quote_id_line_no_key" ON "quote_lines" ("quote_id", "line_no");
CREATE INDEX "quote_lines_tenant_id_idx" ON "quote_lines" ("tenant_id");

ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT hacia el catálogo, igual que `sale_items`.
--
-- El primer intento fue SET NULL, razonando que borrar un servicio COTIZADO
-- debería poder hacerse —una cotización es un papel, no una venta— y que
-- `description` bastaba como constancia. **Un test lo tumbó y tenía razón:**
-- SET NULL deja la línea con CERO referencias y eso viola su propio CHECK de
-- «exactamente uno». Las dos reglas no podían convivir.
--
-- Se eligió conservar el CHECK fuerte. El costo, dicho sin adornos: **un
-- producto o servicio que alguna vez se cotizó ya no se puede BORRAR** — se
-- DESACTIVA, que es el camino que el catálogo ya ofrece y que el diálogo de
-- borrado nombra. Se prefirió un error ruidoso con salida conocida antes que
-- permitir una línea vacía, que sería silenciosa y saldría impresa en el
-- papel que el cliente se lleva.
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_presentation_id_fkey"
  FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- La FK que F4-DB-01 dejó reservada: `sales.quote_id` ya tiene a dónde apuntar
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE "sales" ADD CONSTRAINT "sales_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['quotes', 'quote_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
