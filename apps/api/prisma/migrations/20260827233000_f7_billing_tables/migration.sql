-- F7-DB-04: pagos registrados, cupones y el registro de avisos del cron.
-- Las tres llevan la RLS canónica; el bypass del backoffice llega en la
-- migración siguiente.

CREATE TABLE "subscription_payments" (
  "id"                UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"         UUID           NOT NULL,
  "subscription_id"   UUID           NOT NULL,
  "plan_id"           UUID           NOT NULL,
  "plan_code"         VARCHAR(16)    NOT NULL,
  "billing_cycle"     VARCHAR(8)     NOT NULL,
  "gross_amount"      DECIMAL(14,2)  NOT NULL,
  "discount_amount"   DECIMAL(14,2)  NOT NULL DEFAULT 0,
  "amount"            DECIMAL(14,2)  NOT NULL,
  "currency"          CHAR(3)        NOT NULL DEFAULT 'MXN',
  "discount_id"       UUID,
  "method"            VARCHAR(16)    NOT NULL,
  "gateway"           VARCHAR(16)    NOT NULL DEFAULT 'manual',
  "gateway_reference" VARCHAR(128),
  "external_id"       VARCHAR(128),
  "paid_at"           TIMESTAMPTZ(6) NOT NULL,
  "period_start"      TIMESTAMPTZ(6) NOT NULL,
  "period_end"        TIMESTAMPTZ(6) NOT NULL,
  "status"            VARCHAR(16)    NOT NULL DEFAULT 'recorded',
  "voided_at"         TIMESTAMPTZ(6),
  "voided_by"         UUID,
  "void_reason"       TEXT,
  "recorded_by"       UUID,
  "notes"             TEXT,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "subscription_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscription_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "subscription_payments_subscription_id_fkey" FOREIGN KEY ("subscription_id")
    REFERENCES "tenant_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "subscription_payments_plan_id_fkey" FOREIGN KEY ("plan_id")
    REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "subscription_payments_tenant_id_paid_at_idx" ON "subscription_payments"("tenant_id", "paid_at" DESC);
CREATE INDEX "subscription_payments_subscription_id_period_end_idx" ON "subscription_payments"("subscription_id", "period_end" DESC);

-- La idempotencia del webhook FUTURO ya vive en la base (inerte hoy: todo
-- pago manual tiene external_id NULL y el índice parcial no lo mira).
CREATE UNIQUE INDEX "subscription_payments_external_uq"
  ON "subscription_payments"("gateway", "external_id") WHERE "external_id" IS NOT NULL;

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_amount_coherent"
  CHECK ("amount" = "gross_amount" - "discount_amount");

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_amounts_non_negative"
  CHECK ("gross_amount" >= 0 AND "discount_amount" >= 0 AND "amount" >= 0);

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_method_check"
  CHECK ("method" IN ('transfer', 'cash', 'card', 'other', 'courtesy'));

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_status_check"
  CHECK ("status" IN ('recorded', 'voided'));

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_gateway_check"
  CHECK ("gateway" IN ('manual', 'stripe'));

ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_period_check"
  CHECK ("period_end" > "period_start");

-- Anulado y su rastro van juntos, como quotes: canceled ⇔ sus columnas.
ALTER TABLE "subscription_payments"
  ADD CONSTRAINT "subscription_payments_void_coherent"
  CHECK (("status" = 'voided') = ("voided_at" IS NOT NULL));

CREATE TABLE "tenant_discounts" (
  "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"       UUID           NOT NULL,
  "kind"            VARCHAR(16)    NOT NULL,
  "amount"          DECIMAL(14,2),
  "currency"        CHAR(3)        NOT NULL DEFAULT 'MXN',
  "starts_at"       TIMESTAMPTZ(6) NOT NULL,
  "ends_at"         TIMESTAMPTZ(6),
  "max_periods"     SMALLINT,
  "applied_periods" SMALLINT       NOT NULL DEFAULT 0,
  "reason"          TEXT,
  "is_active"       BOOLEAN        NOT NULL DEFAULT true,
  "created_by"      UUID,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "tenant_discounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_discounts_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "tenant_discounts"
  ADD CONSTRAINT "tenant_discounts_kind_check"
  CHECK ("kind" IN ('fixed_amount', 'free'));

-- Un cupón de monto exige el monto; uno gratis no lo lleva.
ALTER TABLE "tenant_discounts"
  ADD CONSTRAINT "tenant_discounts_amount_coherent"
  CHECK (
    ("kind" <> 'fixed_amount' OR ("amount" IS NOT NULL AND "amount" > 0))
    AND ("kind" <> 'free' OR "amount" IS NULL)
  );

-- UN solo descuento activo por tenant: no se apilan cupones — se revoca uno
-- y se otorga otro. Si algún día hace falta apilar, se dropea este índice y
-- se agrega orden de aplicación; el modelo no cambia.
CREATE UNIQUE INDEX "tenant_discounts_one_active_uq"
  ON "tenant_discounts"("tenant_id") WHERE "is_active";

CREATE TABLE "billing_notifications" (
  "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"       UUID           NOT NULL,
  "subscription_id" UUID           NOT NULL,
  "kind"            VARCHAR(32)    NOT NULL,
  "anchor_at"       TIMESTAMPTZ(6) NOT NULL,
  "sent_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "billing_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_notifications_subscription_id_fkey" FOREIGN KEY ("subscription_id")
    REFERENCES "tenant_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "billing_notifications"
  ADD CONSTRAINT "billing_notifications_kind_check"
  CHECK ("kind" IN ('trial_ending', 'trial_ended', 'due_soon_7', 'due_soon_3', 'due_today', 'past_due', 'grace_ending', 'downgraded'));

-- ESTE UNIQUE es la idempotencia de los avisos: el cron inserta ANTES de
-- mandar el correo; si corre dos veces, el segundo INSERT rebota con 23505.
CREATE UNIQUE INDEX "billing_notifications_dedup_uq"
  ON "billing_notifications"("subscription_id", "kind", "anchor_at");

-- RLS canónica en las tres.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['subscription_payments', 'tenant_discounts', 'billing_notifications'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      || 'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      || 'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END $$;
