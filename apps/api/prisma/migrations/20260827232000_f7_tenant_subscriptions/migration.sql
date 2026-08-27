-- F7-DB-03: UNA suscripción por tenant, con la máquina de estados blindada
-- por CHECKs de coherencia (patrón `quotes_status_coherent` de F4): un
-- estado sin sus fechas obligatorias no puede existir ni por bug.
--
-- `anchor_day` es COLUMNA y se fija con el PRIMER pago: si el próximo
-- vencimiento se derivara del `service_period_end` resultante, un febrero
-- convertiría al cliente del 31 en cliente del 28 para siempre.

CREATE TABLE "tenant_subscriptions" (
  "id"                      UUID        NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"               UUID        NOT NULL,
  "plan_id"                 UUID        NOT NULL,
  "status"                  VARCHAR(16) NOT NULL,
  "billing_cycle"           VARCHAR(8),
  "anchor_day"              SMALLINT,
  "trial_ends_at"           TIMESTAMPTZ(6),
  "service_period_start"    TIMESTAMPTZ(6),
  "service_period_end"      TIMESTAMPTZ(6),
  "due_at"                  TIMESTAMPTZ(6),
  "grace_ends_at"           TIMESTAMPTZ(6),
  "custom_price"            DECIMAL(14,2),
  "canceled_at"             TIMESTAMPTZ(6),
  "cancel_at_period_end"    BOOLEAN     NOT NULL DEFAULT false,
  "notes"                   TEXT,
  "gateway"                 VARCHAR(16) NOT NULL DEFAULT 'manual',
  "gateway_customer_id"     VARCHAR(64),
  "gateway_subscription_id" VARCHAR(64),
  "created_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"              TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tenant_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id")
    REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "tenant_subscriptions_tenant_id_key" ON "tenant_subscriptions"("tenant_id");
-- El barrido del cron entra por estos dos.
CREATE INDEX "tenant_subscriptions_status_due_at_idx" ON "tenant_subscriptions"("status", "due_at");
CREATE INDEX "tenant_subscriptions_status_trial_ends_at_idx" ON "tenant_subscriptions"("status", "trial_ends_at");

ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_status_check"
  CHECK ("status" IN ('trialing', 'active', 'past_due', 'free', 'canceled'));

ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_cycle_check"
  CHECK ("billing_cycle" IS NULL OR "billing_cycle" IN ('monthly', 'yearly'));

ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_anchor_check"
  CHECK ("anchor_day" IS NULL OR ("anchor_day" BETWEEN 1 AND 31));

ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_gateway_check"
  CHECK ("gateway" IN ('manual', 'stripe'));

ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_custom_price_check"
  CHECK ("custom_price" IS NULL OR "custom_price" >= 0);

-- La coherencia de la máquina de estados (ver el diagrama en Fase 7):
--  trialing exige su fin de trial; active exige vencimiento, ciclo y ancla;
--  past_due exige el fin de la gracia; canceled exige su fecha.
ALTER TABLE "tenant_subscriptions"
  ADD CONSTRAINT "tenant_subscriptions_status_coherent"
  CHECK (
    ("status" <> 'trialing' OR "trial_ends_at" IS NOT NULL)
    AND ("status" <> 'active' OR ("due_at" IS NOT NULL AND "billing_cycle" IS NOT NULL AND "anchor_day" IS NOT NULL))
    AND ("status" <> 'past_due' OR "grace_ends_at" IS NOT NULL)
    AND ("status" <> 'canceled' OR "canceled_at" IS NOT NULL)
  );

-- RLS canónica — texto idéntico al de las otras 20+ tablas (es un contrato).
ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenant_subscriptions" FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
