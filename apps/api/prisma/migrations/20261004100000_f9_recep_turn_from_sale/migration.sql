-- F9-RECEP-22 — la venta de un servicio genera el turno de Recepción
-- (F9-RECEP-21..30, ley 31 de la Fase 9; decisión de Carlos, 2026-10-21).
--
-- Tres piezas, todas aditivas; sin backfill: lo que ya existe queda como hoy.
--
--   1. `sales.annotations` — lo que un módulo vertical le devuelve a la venta
--      («Turno: 7») para que la caja lo imprima en el ticket, también al
--      reimprimirse. La caja no sabe qué significa: lo guarda, lo imprime y lo
--      devuelve. Default constante: agregar la columna es instantáneo aunque la
--      tabla sea grande, y toda venta anterior queda con `[]`.
--   2. `reception_turn_services` — los servicios que, al venderse, generan un
--      turno. Sin filas (el default de todo negocio), ninguna venta genera
--      turnos: los negocios que solo usan «Generar turno» no notan nada.
--   3. `reception_turns.sale_id` — el turno sabe de qué venta nació, para que
--      la lista diga «Pagado · VTA-…» o «Venta anulada».

-- ── 1. Las anotaciones de la venta ─────────────────────────────────────────
ALTER TABLE "sales" ADD COLUMN "annotations" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "sales" ADD CONSTRAINT "sales_annotations_is_array"
  CHECK (jsonb_typeof("annotations") = 'array');

-- ── 2. Los servicios que generan turno ─────────────────────────────────────
-- El servicio que se borra se va de la lista (CASCADE); el API ya impide
-- borrar uno con ventas, así que en la práctica solo se borran los nuevos.
CREATE TABLE "reception_turn_services" (
    "tenant_id"  UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),

    CONSTRAINT "reception_turn_services_pkey" PRIMARY KEY ("tenant_id", "service_id")
);

ALTER TABLE "reception_turn_services" ADD CONSTRAINT "reception_turn_services_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reception_turn_services" ADD CONSTRAINT "reception_turn_services_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Aislamiento por tenant, desde el minuto cero (molde f9_recep_settings).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reception_turn_services']
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

-- ── 3. El turno sabe de qué venta nació ────────────────────────────────────
-- SET NULL y no RESTRICT: una venta no se borra (solo `purge_tenant`, que
-- desarma los FK), pero si algún día se hiciera, el turno sobrevive con su
-- número; lo que pierde es el enlace.
ALTER TABLE "reception_turns" ADD COLUMN "sale_id" UUID;
ALTER TABLE "reception_turns" ADD CONSTRAINT "reception_turns_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "reception_turns_tenant_id_sale_id_idx" ON "reception_turns"("tenant_id", "sale_id");
