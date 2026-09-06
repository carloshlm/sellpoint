-- F4-TAX-04 — Impuestos de venta por país: el modo del negocio, su catálogo
-- de impuestos, el grupo de cada artículo y el snapshot en cada documento.
--
-- ── Dos preguntas gobiernan todo ─────────────────────────────────────────
-- `tenants.tax_mode`: ¿el precio de catálogo YA trae el impuesto? (`included`:
-- México, la UE; `excluded`: Canadá, EE. UU.). Y el grupo de impuesto de cada
-- artículo (`tax_group_id`, NULL = el default del negocio).
--
-- ── El catálogo: grupos y sus componentes ────────────────────────────────
-- `tax_groups` es lo que se asigna a un artículo («IVA 16%», «GST 5% + PST
-- 7%», «Exento»); `tax_rates` son sus componentes, con FK al grupo (no N:M:
-- que «GST 5%» viva en dos grupos de un negocio canadiense es un dato de
-- cinco caracteres, no una tabla más con RLS). Un grupo SIN tasas es exento;
-- uno con tasa 0 es tasa cero: se distinguen por el nombre, sin columna extra.
-- Un solo default ACTIVO por negocio: índice único parcial (Prisma no lo
-- modela; queda comentado en el modelo, como los de F3).
--
-- ── El snapshot: por qué el MODO viaja en el documento ───────────────────
-- En `included` el impuesto está DENTRO de `line_total`; en `excluded` está
-- FUERA. Sin `sales.tax_mode`, un ticket reimpreso después de cambiar el
-- modo saldría en la unidad equivocada y ningún dato lo desambiguaría. Los
-- históricos quedan `included` con `tax_total = 0`: se leen correctos sin
-- backfill (total = Σ line_total, neto = total).
--
-- Sin `net_amount`/`net_total`: son derivables (`neto = total − tax_total`) y
-- guardarlos abriría una deriva que nadie podría arbitrar. El invariante:
--   sales.total = Σ sale_items.line_total = neto + tax_total   (en los dos modos)
--   Σ sale_items.tax_amount = Σ sale_taxes.amount
-- `sale_taxes` va por venta y por componente (lo que imprime el ticket — CRA
-- exige GST/HST separado del PST — y lo que suma el reporte fiscal); el
-- porqué de cada línea lo contesta `sale_items.tax_group_code`.
--
-- `tenants` no lleva RLS (su id ES el tenant): `tax_mode` y `region` van ahí
-- sin policy. Las cuatro tablas nuevas sí, con la canónica + FORCE.

-- ── El negocio ───────────────────────────────────────────────────────────
ALTER TABLE "tenants"
  ADD COLUMN "tax_mode" VARCHAR(8) NOT NULL DEFAULT 'included',
  ADD COLUMN "region"   VARCHAR(8);
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_tax_mode_check"
  CHECK ("tax_mode" IN ('included', 'excluded'));
-- ISO 3166-2 sin el prefijo del país (`ON`, `BC`, `TX`); el catálogo de
-- provincias y estados vive en shared y se valida en el DTO.
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_region_format"
  CHECK ("region" IS NULL OR "region" ~ '^[A-Z0-9]{1,3}$');

-- ── El catálogo del negocio ──────────────────────────────────────────────
CREATE TABLE "tax_groups" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,
    "code"       VARCHAR(32) NOT NULL,
    "name"       VARCHAR(60) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tax_groups_pkey" PRIMARY KEY ("id"),
    -- El código es un identificador: es lo que viaja en la planilla.
    CONSTRAINT "tax_groups_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,32}$'),
    CONSTRAINT "tax_groups_name_not_blank" CHECK (btrim("name") <> '')
);
CREATE UNIQUE INDEX "tax_groups_tenant_id_code_key" ON "tax_groups"("tenant_id", "code");
CREATE INDEX "tax_groups_tenant_id_idx" ON "tax_groups"("tenant_id");
-- Un solo default ACTIVO por negocio. Se valida fila por fila: cambiar el
-- default son DOS sentencias en la misma transacción (apagar, prender).
CREATE UNIQUE INDEX "tax_groups_one_default" ON "tax_groups"("tenant_id")
  WHERE "is_default" AND "is_active";
ALTER TABLE "tax_groups" ADD CONSTRAINT "tax_groups_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tax_rates" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    -- Denormalizado a propósito, como `service_warehouses`: la policy compara
    -- la columna sin depender de un JOIN.
    "tenant_id"    UUID NOT NULL,
    "tax_group_id" UUID NOT NULL,
    "code"         VARCHAR(16) NOT NULL,
    "name"         VARCHAR(40) NOT NULL,
    "rate"         DECIMAL(7,4) NOT NULL,
    "sort_order"   INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_rates_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,16}$'),
    CONSTRAINT "tax_rates_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100)
);
CREATE UNIQUE INDEX "tax_rates_tax_group_id_code_key" ON "tax_rates"("tax_group_id", "code");
CREATE INDEX "tax_rates_tenant_id_idx" ON "tax_rates"("tenant_id");
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_group_id_fkey"
  FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── El artículo (NULL = el default del negocio) ──────────────────────────
-- RESTRICT: un grupo con artículos no se borra, se desactiva (409 en el API).
ALTER TABLE "products" ADD COLUMN "tax_group_id" UUID;
ALTER TABLE "products" ADD CONSTRAINT "products_tax_group_id_fkey"
  FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "products_tax_group_id_idx" ON "products"("tax_group_id");

ALTER TABLE "services" ADD COLUMN "tax_group_id" UUID;
ALTER TABLE "services" ADD CONSTRAINT "services_tax_group_id_fkey"
  FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "services_tax_group_id_idx" ON "services"("tax_group_id");

ALTER TABLE "medical_clinic_lab_studies" ADD COLUMN "tax_group_id" UUID;
ALTER TABLE "medical_clinic_lab_studies" ADD CONSTRAINT "medical_clinic_lab_studies_tax_group_id_fkey"
  FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "medical_clinic_lab_studies_tax_group_id_idx" ON "medical_clinic_lab_studies"("tax_group_id");

ALTER TABLE "medical_clinic_diagnostic_studies" ADD COLUMN "tax_group_id" UUID;
ALTER TABLE "medical_clinic_diagnostic_studies" ADD CONSTRAINT "medical_clinic_diagnostic_studies_tax_group_id_fkey"
  FOREIGN KEY ("tax_group_id") REFERENCES "tax_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "medical_clinic_diagnostic_studies_tax_group_id_idx" ON "medical_clinic_diagnostic_studies"("tax_group_id");

-- ── El documento: la venta ───────────────────────────────────────────────
ALTER TABLE "sales"
  ADD COLUMN "tax_mode"  VARCHAR(8) NOT NULL DEFAULT 'included',
  ADD COLUMN "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD CONSTRAINT "sales_tax_mode_check"
  CHECK ("tax_mode" IN ('included', 'excluded'));
ALTER TABLE "sales" ADD CONSTRAINT "sales_tax_total_nonnegative" CHECK ("tax_total" >= 0);

ALTER TABLE "sale_items"
  ADD COLUMN "tax_amount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tax_group_code" VARCHAR(32);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_tax_amount_nonnegative" CHECK ("tax_amount" >= 0);

CREATE TABLE "sale_taxes" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,
    "sale_id"    UUID NOT NULL,
    "code"       VARCHAR(16) NOT NULL,
    "name"       VARCHAR(40) NOT NULL,
    "rate"       DECIMAL(7,4) NOT NULL,
    "base"       DECIMAL(14,2) NOT NULL,
    "amount"     DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sale_taxes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_taxes_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100),
    CONSTRAINT "sale_taxes_amount_nonnegative" CHECK ("amount" >= 0 AND "base" >= 0)
);
CREATE UNIQUE INDEX "sale_taxes_sale_id_code_key" ON "sale_taxes"("sale_id", "code");
CREATE INDEX "sale_taxes_tenant_id_idx" ON "sale_taxes"("tenant_id");
ALTER TABLE "sale_taxes" ADD CONSTRAINT "sale_taxes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_taxes" ADD CONSTRAINT "sale_taxes_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── El documento: la cotización (espejo exacto) ──────────────────────────
ALTER TABLE "quotes"
  ADD COLUMN "tax_mode"  VARCHAR(8) NOT NULL DEFAULT 'included',
  ADD COLUMN "tax_total" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tax_mode_check"
  CHECK ("tax_mode" IN ('included', 'excluded'));
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_tax_total_nonnegative" CHECK ("tax_total" >= 0);

ALTER TABLE "quote_lines"
  ADD COLUMN "tax_amount"     DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "tax_group_code" VARCHAR(32);
ALTER TABLE "quote_lines" ADD CONSTRAINT "quote_lines_tax_amount_nonnegative" CHECK ("tax_amount" >= 0);

CREATE TABLE "quote_taxes" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,
    "quote_id"   UUID NOT NULL,
    "code"       VARCHAR(16) NOT NULL,
    "name"       VARCHAR(40) NOT NULL,
    "rate"       DECIMAL(7,4) NOT NULL,
    "base"       DECIMAL(14,2) NOT NULL,
    "amount"     DECIMAL(14,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quote_taxes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "quote_taxes_rate_range" CHECK ("rate" >= 0 AND "rate" <= 100),
    CONSTRAINT "quote_taxes_amount_nonnegative" CHECK ("amount" >= 0 AND "base" >= 0)
);
CREATE UNIQUE INDEX "quote_taxes_quote_id_code_key" ON "quote_taxes"("quote_id", "code");
CREATE INDEX "quote_taxes_tenant_id_idx" ON "quote_taxes"("tenant_id");
ALTER TABLE "quote_taxes" ADD CONSTRAINT "quote_taxes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "quote_taxes" ADD CONSTRAINT "quote_taxes_quote_id_fkey"
  FOREIGN KEY ("quote_id") REFERENCES "quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_groups', 'tax_rates', 'sale_taxes', 'quote_taxes']
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
END $$;
