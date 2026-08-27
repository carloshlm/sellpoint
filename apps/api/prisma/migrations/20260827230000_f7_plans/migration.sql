-- F7-DB-01: el catálogo de planes y sus precios por MERCADO.
--
-- SIN RLS a propósito (mismo criterio que `permissions` y `units`): son
-- catálogo global sin tenant_id — todo el mundo los lee (la pantalla de
-- planes es pública) y solo el dueño de la plataforma los escribe. Los
-- GRANTs a `sellpoint_app` los cubre el ALTER DEFAULT PRIVILEGES de
-- `20260806172006_app_db_user`.
--
-- Los PRECIOS viven en `plan_prices` (una fila por plan y país) y no como
-- columnas de `plans`: el precio es por MERCADO, no por tipo de cambio —
-- $199 MXN convertidos serían ~$11 USD contra el Square de $29. La fila del
-- país del tenant gana; sin fila, cae a la tarifa `US` (default
-- internacional). free y premium no tienen filas (sin precio publicado).

CREATE TABLE "plans" (
  "id"                 UUID        NOT NULL DEFAULT gen_random_uuid(),
  "code"               VARCHAR(16) NOT NULL,
  "name"               VARCHAR(64) NOT NULL,
  "description"        TEXT,
  "sort_order"         SMALLINT    NOT NULL DEFAULT 0,
  "is_public"          BOOLEAN     NOT NULL DEFAULT true,
  "is_active"          BOOLEAN     NOT NULL DEFAULT true,
  "max_users"          INTEGER,
  "max_warehouses"     INTEGER,
  "daily_sales_limit"  INTEGER,
  "write_access"       BOOLEAN     NOT NULL DEFAULT true,
  "stock_control"      BOOLEAN     NOT NULL DEFAULT true,
  "features"           JSONB       NOT NULL DEFAULT '{}',
  "gateway_product_id" VARCHAR(64),
  "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- El catálogo cerrado de códigos: espejo de PLAN_CODES en @sellpoint/shared.
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_code_check"
  CHECK ("code" IN ('free', 'basic', 'pro', 'plus', 'premium'));

-- Los límites, si existen, son positivos; cero usuarios no es un plan, es un
-- borrado disfrazado.
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_limits_positive"
  CHECK (
    ("max_users" IS NULL OR "max_users" > 0)
    AND ("max_warehouses" IS NULL OR "max_warehouses" > 0)
    AND ("daily_sales_limit" IS NULL OR "daily_sales_limit" > 0)
  );

CREATE TABLE "plan_prices" (
  "id"                       UUID           NOT NULL DEFAULT gen_random_uuid(),
  "plan_id"                  UUID           NOT NULL,
  "country"                  CHAR(2)        NOT NULL,
  "currency"                 CHAR(3)        NOT NULL,
  "price_monthly"            DECIMAL(14,2)  NOT NULL,
  "price_yearly"             DECIMAL(14,2)  NOT NULL,
  "gateway_price_monthly_id" VARCHAR(64),
  "gateway_price_yearly_id"  VARCHAR(64),
  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id")
    REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "plan_prices_plan_id_country_key" ON "plan_prices"("plan_id", "country");

ALTER TABLE "plan_prices"
  ADD CONSTRAINT "plan_prices_monthly_positive" CHECK ("price_monthly" > 0);

-- "2 meses gratis" es una regla de la casa, no una coincidencia del seed: el
-- CHECK la vuelve imposible de romper por un UPDATE a medias desde el
-- backoffice.
ALTER TABLE "plan_prices"
  ADD CONSTRAINT "plan_prices_yearly_is_ten_months"
  CHECK ("price_yearly" = "price_monthly" * 10);
