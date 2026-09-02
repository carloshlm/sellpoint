-- F9-RECEP-03 — los turnos de Recepción.
--
-- `business_date` + `number`: el número reinicia en 1 con el DÍA DEL NEGOCIO
-- (`tenant.timezone`), y cada fecha es una serie nueva en `tenant_sequences`
-- (`reception_turn:YYYYMMDD`, mismo patrón que el código de ticket del POS).
-- El UNIQUE es el cinturón por si alguien toca la secuencia a mano.
--
-- `customer_id ... ON DELETE SET NULL` + `customer_name`: «Eliminar» un
-- cliente borra de verdad, y el historial del día sigue diciendo a quién se
-- atendió gracias al snapshot del nombre.
--
-- La RLS va en ESTA migración, no en una posterior.

CREATE TABLE "reception_turns" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"     UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "number"        INTEGER NOT NULL,
    "customer_id"   UUID,
    "customer_name" VARCHAR(200),
    "status"        VARCHAR(16) NOT NULL DEFAULT 'waiting',
    "attended_at"   TIMESTAMPTZ(6),
    "attended_by"   UUID,
    "created_by"    UUID,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reception_turns_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "reception_turns" ADD CONSTRAINT "reception_turns_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reception_turns" ADD CONSTRAINT "reception_turns_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "reception_turns_tenant_id_business_date_number_key"
  ON "reception_turns" ("tenant_id", "business_date", "number");
-- El listado del día, del número mayor al menor.
CREATE INDEX "reception_turns_tenant_id_business_date_number_idx"
  ON "reception_turns" ("tenant_id", "business_date", "number" DESC);

ALTER TABLE "reception_turns"
  ADD CONSTRAINT "reception_turns_status_check" CHECK ("status" IN ('waiting', 'attended'));
ALTER TABLE "reception_turns"
  ADD CONSTRAINT "reception_turns_number_check" CHECK ("number" > 0);
-- Atendido ⇔ tiene hora de atención: un estado sin su fecha no puede existir ni por bug.
ALTER TABLE "reception_turns"
  ADD CONSTRAINT "reception_turns_attended_coherent"
  CHECK (("status" = 'attended') = ("attended_at" IS NOT NULL));

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reception_turns']
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
