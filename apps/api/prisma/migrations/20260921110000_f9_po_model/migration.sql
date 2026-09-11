-- F9-PO-03 — ÓRDENES DE COMPRA y RECEPCIONES: el compromiso y el andén.
--
-- ── Tres papeles, ninguno sustituye al otro ────────────────────────────────
--
-- La ORDEN es el compromiso con el proveedor: qué se pidió, a qué precio
-- acordado, para cuándo y a qué almacén. La RECEPCIÓN es el papel del andén:
-- qué llegó, con qué remisión (packing slip) y con qué lote — casi nunca
-- coincide con la orden a la primera (llegan 60 de 100). La COMPRA (F9-PURCH)
-- sigue siendo la factura, y nace de lo recibido. Entre las tres se hace el
-- «three-way match»: las diferencias de cantidad y de precio se VEN.
--
-- ── La recepción NO mueve existencias ──────────────────────────────────────
--
-- Confirmarla solo suma `quantity_received` en la línea de la orden. La
-- mercancía entra al kardex por la entrada que nace de la compra, como hoy:
-- así el costo del catálogo sigue siendo el de la FACTURA y nunca el
-- acordado. (La alternativa —stock al costo esperado con corrección por
-- factura— es la cuenta puente de un ERP; queda pospuesta con nombre.)
--
-- ── Los totales de la orden son ESPERADOS ──────────────────────────────────
--
-- Misma aritmética que la compra (`armarCompra` sin cargos) para que el
-- estimado sea comparable con la factura, pero informativo: nunca contable.

-- ─────────────────────────────────────────────────────────────────────────
-- La orden
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "purchase_orders" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "folio"              VARCHAR(20) NOT NULL,
    "status"             VARCHAR(20) NOT NULL DEFAULT 'draft',
    "supplier_id"        UUID NOT NULL,
    -- «Entregar en»: el almacén que recibirá.
    "warehouse_id"       UUID NOT NULL,
    "order_date"         DATE NOT NULL,
    -- La ÚNICA fecha del módulo que puede ser futura: es una promesa, no un
    -- hecho. Sin CHECK contra `order_date`: una entrega para hoy mismo vale.
    "expected_date"      DATE,
    -- La cotización o el número con que el proveedor conoce el pedido.
    "supplier_reference" VARCHAR(120),
    "payment_terms"      VARCHAR(120),
    "tax_mode"           VARCHAR(8) NOT NULL DEFAULT 'excluded',
    "subtotal"           NUMERIC(14,2) NOT NULL DEFAULT 0,
    "discount"           NUMERIC(14,2) NOT NULL DEFAULT 0,
    "tax_total"          NUMERIC(14,2) NOT NULL DEFAULT 0,
    "total"              NUMERIC(14,2) NOT NULL DEFAULT 0,
    "notes"              TEXT,
    "issued_by"          UUID,
    "issued_at"          TIMESTAMPTZ(6),
    "closed_by"          UUID,
    "closed_at"          TIMESTAMPTZ(6),
    "canceled_by"        UUID,
    "canceled_at"        TIMESTAMPTZ(6),
    "cancel_reason"      TEXT,
    "created_by"         UUID NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_warehouse_id_fkey"
  FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_issued_by_fkey"
  FOREIGN KEY ("issued_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_by_fkey"
  FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_orders_tenant_id_folio_key" ON "purchase_orders" ("tenant_id", "folio");
CREATE INDEX "purchase_orders_tenant_id_order_date_idx"
  ON "purchase_orders" ("tenant_id", "order_date" DESC);
CREATE INDEX "purchase_orders_tenant_id_status_expected_date_idx"
  ON "purchase_orders" ("tenant_id", "status", "expected_date");
CREATE INDEX "purchase_orders_tenant_id_supplier_id_order_date_idx"
  ON "purchase_orders" ("tenant_id", "supplier_id", "order_date" DESC);

ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check"
  CHECK ("status" IN ('draft', 'open', 'partially_received', 'received', 'closed', 'canceled'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tax_mode_check"
  CHECK ("tax_mode" IN ('included', 'excluded'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_amounts_nonnegative"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "tax_total" >= 0 AND "total" >= 0);
-- Los sellos por estado. Un borrador no tiene historia; una orden viva
-- (open, partially_received, received) tiene su emisión y nada más; cerrada
-- conserva la emisión y suma el cierre; anulada exige quién, cuándo y por
-- qué (y conserva lo que tuviera).
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_draft_has_no_stamps"
  CHECK ("status" <> 'draft'
         OR ("issued_at" IS NULL AND "closed_at" IS NULL AND "canceled_at" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_live_coherent"
  CHECK ("status" NOT IN ('open', 'partially_received', 'received')
         OR ("issued_at" IS NOT NULL AND "issued_by" IS NOT NULL
             AND "closed_at" IS NULL AND "canceled_at" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_closed_coherent"
  CHECK ("status" <> 'closed'
         OR ("issued_at" IS NOT NULL AND "closed_at" IS NOT NULL AND "closed_by" IS NOT NULL
             AND "canceled_at" IS NULL));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_canceled_coherent"
  CHECK ("status" <> 'canceled'
         OR ("canceled_at" IS NOT NULL AND "canceled_by" IS NOT NULL
             AND "cancel_reason" IS NOT NULL));

-- ─────────────────────────────────────────────────────────────────────────
-- Las líneas: lo pedido, lo recibido y lo que ya no llegará
-- ─────────────────────────────────────────────────────────────────────────
--
-- `quantity_received` se MATERIALIZA acá al confirmar cada recepción (y se
-- devuelve al anularla): es lo que el listado y el estado derivado leen sin
-- sumar recepciones. `closed_short` es la decisión de una persona: «el
-- proveedor ya no surtirá el resto», y la línea se da por terminada.
CREATE TABLE "purchase_order_lines" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"         UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "line_no"           INTEGER NOT NULL,
    "product_id"        UUID NOT NULL,
    "presentation_id"   UUID,
    "quantity_ordered"  NUMERIC(14,4) NOT NULL,
    "quantity_received" NUMERIC(14,4) NOT NULL DEFAULT 0,
    "closed_short"      BOOLEAN NOT NULL DEFAULT false,
    -- El costo ACORDADO: lo que se coteja contra la factura. Nullable en el
    -- borrador; emitir lo exige.
    "unit_cost"         NUMERIC(14,2),
    "discount"          NUMERIC(14,2) NOT NULL DEFAULT 0,
    "tax_group_code"    VARCHAR(32),
    "tax_amount"        NUMERIC(14,2) NOT NULL DEFAULT 0,
    "line_total"        NUMERIC(14,2) NOT NULL DEFAULT 0,
    "description"       TEXT NOT NULL,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_presentation_id_fkey"
  FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_order_lines_purchase_order_id_line_no_key"
  ON "purchase_order_lines" ("purchase_order_id", "line_no");
CREATE INDEX "purchase_order_lines_tenant_id_product_id_idx"
  ON "purchase_order_lines" ("tenant_id", "product_id");

ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_line_no_check"
  CHECK ("line_no" >= 1);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_quantities_check"
  CHECK ("quantity_ordered" > 0
         AND "quantity_received" >= 0 AND "quantity_received" <= "quantity_ordered");
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_amounts_check"
  CHECK (("unit_cost" IS NULL OR "unit_cost" >= 0)
         AND "discount" >= 0 AND "tax_amount" >= 0 AND "line_total" >= 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_description_check"
  CHECK (btrim("description") <> '');

-- ─────────────────────────────────────────────────────────────────────────
-- Los impuestos ESTIMADOS: espejo de `purchase_taxes`
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "purchase_order_taxes" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"         UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "code"              VARCHAR(16) NOT NULL,
    "name"              VARCHAR(40) NOT NULL,
    "rate"              NUMERIC(7,4) NOT NULL,
    "base"              NUMERIC(14,2) NOT NULL,
    "amount"            NUMERIC(14,2) NOT NULL,
    "sort_order"        INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "purchase_order_taxes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_taxes_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100),
    CONSTRAINT "purchase_order_taxes_amount_nonnegative" CHECK ("amount" >= 0 AND "base" >= 0)
);

ALTER TABLE "purchase_order_taxes" ADD CONSTRAINT "purchase_order_taxes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_taxes" ADD CONSTRAINT "purchase_order_taxes_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_order_taxes_purchase_order_id_code_key"
  ON "purchase_order_taxes" ("purchase_order_id", "code");
CREATE INDEX "purchase_order_taxes_tenant_id_idx" ON "purchase_order_taxes" ("tenant_id");

-- ─────────────────────────────────────────────────────────────────────────
-- La recepción: el papel del andén
-- ─────────────────────────────────────────────────────────────────────────
--
-- `purchase_id` es la COMPRA que la facturó: una recepción se factura UNA
-- vez, y anular esa compra la libera (vuelve a NULL). RESTRICT y no SET
-- NULL a propósito: que una compra desaparezca por debajo de una recepción
-- facturada sería perder el hilo del three-way match sin que nadie lo note.
CREATE TABLE "purchase_receipts" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"         UUID NOT NULL,
    "folio"             VARCHAR(20) NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "status"            VARCHAR(16) NOT NULL DEFAULT 'draft',
    "received_date"     DATE NOT NULL,
    -- La remisión (MX) o el packing slip (US/CA) con que llegó la mercancía.
    "packing_slip"      VARCHAR(120),
    "notes"             TEXT,
    "purchase_id"       UUID,
    "confirmed_by"      UUID,
    "confirmed_at"      TIMESTAMPTZ(6),
    "canceled_by"       UUID,
    "canceled_at"       TIMESTAMPTZ(6),
    "cancel_reason"     TEXT,
    "created_by"        UUID NOT NULL,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"        TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_purchase_id_fkey"
  FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_confirmed_by_fkey"
  FOREIGN KEY ("confirmed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_receipts_tenant_id_folio_key"
  ON "purchase_receipts" ("tenant_id", "folio");
CREATE INDEX "purchase_receipts_purchase_order_id_status_idx"
  ON "purchase_receipts" ("purchase_order_id", "status");
CREATE INDEX "purchase_receipts_purchase_id_idx"
  ON "purchase_receipts" ("purchase_id") WHERE "purchase_id" IS NOT NULL;

ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_status_check"
  CHECK ("status" IN ('draft', 'confirmed', 'canceled'));
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_draft_has_no_stamps"
  CHECK ("status" <> 'draft' OR ("confirmed_at" IS NULL AND "canceled_at" IS NULL));
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_confirmed_coherent"
  CHECK ("status" <> 'confirmed'
         OR ("confirmed_at" IS NOT NULL AND "confirmed_by" IS NOT NULL AND "canceled_at" IS NULL));
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_canceled_coherent"
  CHECK ("status" <> 'canceled'
         OR ("canceled_at" IS NOT NULL AND "canceled_by" IS NOT NULL
             AND "cancel_reason" IS NOT NULL));

-- ─────────────────────────────────────────────────────────────────────────
-- Las líneas de la recepción: qué llegó, en la presentación de la orden
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE "purchase_receipt_lines" (
    "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"              UUID NOT NULL,
    "receipt_id"             UUID NOT NULL,
    "line_no"                INTEGER NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "quantity"               NUMERIC(14,4) NOT NULL,
    "lot_code"               VARCHAR(64),
    "expires_at"             DATE,
    "notes"                  TEXT,
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "purchase_receipt_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_receipt_lines_line_no_check" CHECK ("line_no" >= 1),
    -- Cero no es «no llegó nada»: una línea que no llegó no se captura.
    CONSTRAINT "purchase_receipt_lines_quantity_check" CHECK ("quantity" > 0)
);

ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_id_fkey"
  FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_receipt_lines"
  ADD CONSTRAINT "purchase_receipt_lines_purchase_order_line_id_fkey"
  FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "purchase_receipt_lines_receipt_id_line_no_key"
  ON "purchase_receipt_lines" ("receipt_id", "line_no");
CREATE INDEX "purchase_receipt_lines_purchase_order_line_id_idx"
  ON "purchase_receipt_lines" ("purchase_order_line_id");

-- ─────────────────────────────────────────────────────────────────────────
-- El hilo hacia la compra
-- ─────────────────────────────────────────────────────────────────────────
--
-- Nullable: la compra sin orden (el flujo de hoy) sigue existiendo siempre.
ALTER TABLE "purchases" ADD COLUMN "purchase_order_id" UUID;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "purchases_purchase_order_id_idx"
  ON "purchases" ("purchase_order_id") WHERE "purchase_order_id" IS NOT NULL;

ALTER TABLE "purchase_lines" ADD COLUMN "purchase_order_line_id" UUID;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_order_line_id_fkey"
  FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "purchase_lines_purchase_order_line_id_idx"
  ON "purchase_lines" ("purchase_order_line_id") WHERE "purchase_order_line_id" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Lo emitido es intocable — con UNA excepción quirúrgica
-- ─────────────────────────────────────────────────────────────────────────
--
-- Molde: `purchase_child_is_immutable`. La diferencia: `quantity_received` y
-- `closed_short` viven en la línea de la orden, y las mueve la RECEPCIÓN
-- después de emitir. El trigger deja pasar un UPDATE que cambie SOLO esas
-- dos columnas (compara el resto con `to_jsonb`), y rebota cualquier otro:
-- «recibido y costo a la vez» no es un caballo de Troya.
CREATE OR REPLACE FUNCTION public.purchase_order_child_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order_id uuid := COALESCE(NEW.purchase_order_id, OLD.purchase_order_id);
  v_folio text;
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'purchase_order_lines'
     AND (to_jsonb(NEW) - 'quantity_received' - 'closed_short')
       = (to_jsonb(OLD) - 'quantity_received' - 'closed_short') THEN
    RETURN NEW;
  END IF;

  SELECT o.folio, o.status INTO v_folio, v_status
  FROM public.purchase_orders o
  WHERE o.id = v_order_id AND o.status <> 'draft';

  IF FOUND THEN
    RAISE EXCEPTION
      'La orden % (%) ya se emitió: sus líneas e impuestos no se agregan, modifican ni borran (solo lo recibido).',
      v_folio, v_status
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

COMMENT ON FUNCTION public.purchase_order_child_is_immutable() IS
  'F9-PO-03: las líneas e impuestos heredan la inmutabilidad de su orden emitida. Excepción: quantity_received y closed_short, que mueve la recepción.';

CREATE TRIGGER purchase_order_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_order_lines"
  FOR EACH ROW EXECUTE FUNCTION public.purchase_order_child_is_immutable();

CREATE TRIGGER purchase_order_taxes_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_order_taxes"
  FOR EACH ROW EXECUTE FUNCTION public.purchase_order_child_is_immutable();

-- Las líneas de una recepción confirmada: mismo molde, sin excepción.
CREATE OR REPLACE FUNCTION public.purchase_receipt_line_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_receipt_id uuid := COALESCE(NEW.receipt_id, OLD.receipt_id);
  v_folio text;
  v_status text;
BEGIN
  SELECT r.folio, r.status INTO v_folio, v_status
  FROM public.purchase_receipts r
  WHERE r.id = v_receipt_id AND r.status <> 'draft';

  IF FOUND THEN
    RAISE EXCEPTION
      'La recepción % (%) ya no es un borrador: sus líneas no se agregan, modifican ni borran.',
      v_folio, v_status
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER purchase_receipt_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_receipt_lines"
  FOR EACH ROW EXECUTE FUNCTION public.purchase_receipt_line_is_immutable();

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_orders', 'purchase_order_lines', 'purchase_order_taxes',
                           'purchase_receipts', 'purchase_receipt_lines']
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
