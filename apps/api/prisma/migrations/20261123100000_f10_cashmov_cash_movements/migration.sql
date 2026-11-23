-- F10-CASHMOV-01 — las ENTRADAS y los RETIROS de efectivo de un turno.
--
-- Hasta hoy, lo único que salía del cajón era un gasto. Un retiro legítimo
-- (el efectivo que se lleva a la caja fuerte) aparecía como faltante en el
-- arqueo. Esta tabla es el lugar donde se guarda ese movimiento.
--
-- Un movimiento NO es un gasto: no toca la utilidad ni el reporte de Gastos.
-- Solo cambia el efectivo esperado del turno al que pertenece.
--
-- La migración es ADITIVA: una tabla y tres tipos nuevos. No modifica ninguna
-- fila existente; los turnos ya cerrados guardan su `calculated_cash` y no
-- tenían movimientos.
--
-- Molde: `cashbox_sessions` (20260821050000_f4_sales_cashbox) y `expenses`
-- (20260919110000_f9_expenses). Lleva su propio `tenant_id`: lo exige la RLS y
-- también `purge_tenant()` y el teardown de las pruebas, que borran por esa
-- columna con las FK apagadas. La RLS va en ESTA migración: una tabla no debe
-- existir ni un commit sin aislamiento. Los GRANTs a `sellpoint_app` no se
-- declaran: los cubre el ALTER DEFAULT PRIVILEGES de
-- `20260806172006_app_db_user`.

CREATE TYPE "CashMovementType" AS ENUM ('in', 'out');
CREATE TYPE "CashMovementReason" AS ENUM ('change_fund', 'safe', 'bank_deposit', 'owner', 'other');
CREATE TYPE "CashMovementStatus" AS ENUM ('active', 'canceled');

CREATE TABLE "cash_movements" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "cashbox_session_id" UUID NOT NULL,
    "type"               "CashMovementType" NOT NULL,
    "reason"             "CashMovementReason" NOT NULL,
    "amount"             DECIMAL(14,2) NOT NULL,
    "note"               VARCHAR(300),
    "authorized"         BOOLEAN NOT NULL DEFAULT false,
    "status"             "CashMovementStatus" NOT NULL DEFAULT 'active',
    "created_by"         UUID NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "canceled_by"        UUID,
    "canceled_at"        TIMESTAMPTZ(6),
    "cancel_reason"      TEXT,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- El importe siempre es positivo: la dirección la dice el tipo, no el signo.
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_amount_check"
  CHECK ("amount" > 0);

-- El motivo corresponde al tipo. «Fondo para cambio» solo entra; «A la caja
-- fuerte», «Depósito al banco» y «Retiro del dueño» solo salen; «Otro», los dos.
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_reason_matches_type"
  CHECK (
    ("type" = 'in'  AND "reason" IN ('change_fund', 'other'))
    OR ("type" = 'out' AND "reason" IN ('safe', 'bank_deposit', 'owner', 'other'))
  );

-- «Otro» no dice nada por sí solo: exige una nota que no esté en blanco.
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_other_needs_note"
  CHECK ("reason" <> 'other' OR btrim(coalesce("note", '')) <> '');

-- Una anulación coherente, como `cashbox_sessions_closed_coherent`: anulado
-- tiene quién, cuándo y por qué (un motivo en blanco no es motivo); activo no
-- tiene ninguno de los tres. Equivalencia, no implicación: media anulación en
-- una auditoría es peor que ninguna.
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_canceled_coherent"
  CHECK (
    ("status" = 'canceled'
      AND "canceled_at" IS NOT NULL
      AND "canceled_by" IS NOT NULL
      AND "cancel_reason" IS NOT NULL
      AND btrim("cancel_reason") <> '')
    OR ("status" = 'active'
      AND "canceled_at" IS NULL
      AND "canceled_by" IS NULL
      AND "cancel_reason" IS NULL)
  );

-- El arqueo lee los movimientos de un turno: por negocio y turno.
CREATE INDEX "cash_movements_tenant_id_cashbox_session_id_idx"
  ON "cash_movements" ("tenant_id", "cashbox_session_id");

-- RESTRICT, jamás CASCADE ni SET NULL: un turno con movimientos no se borra, y
-- un movimiento huérfano de turno no se puede arquear.
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_cashbox_session_id_fkey"
  FOREIGN KEY ("cashbox_session_id") REFERENCES "cashbox_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_canceled_by_fkey"
  FOREIGN KEY ("canceled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_movements']
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
