-- ── El código de barras diario del ticket (Carlos, 2026-08-24) ─────────────
--
-- La venta gana un código de 12 dígitos para el ticket impreso:
-- `YYYYMMDD` + consecutivo diario de 4 (`202608240045` = ticket 45 del día).
-- El consecutivo "reinicia" cada día sin reset alguno: cada fecha es una
-- serie NUEVA de `tenant_sequences` (`sale_barcode:20260824`), así que no hay
-- contador que poner en cero ni carrera que perder.
--
-- Es un campo APARTE del folio a propósito. El folio `VTA-000009` es la
-- identidad contable —único por tenant para siempre, referenciado por el
-- kardex— y NO puede reiniciar. El código es la etiqueta de escaneo del
-- papel: numérica (estándar de retail), corta, y con la fecha adentro para
-- que la unicidad por día sea estructural.
--
-- UNIQUE parcial por TENANT, no global (mismo criterio que
-- `sales_tenant_idempotency_key`): dos negocios distintos pueden emitir el
-- mismo `202608240001` el mismo día. `WHERE barcode IS NOT NULL` porque las
-- ventas anteriores a esta migración quedan sin código —sin backfill, a
-- propósito: son datos de prueba y el ticket reimpreso cae a las barras del
-- folio, que el buscador ya resuelve—.
ALTER TABLE "sales" ADD COLUMN "barcode" VARCHAR(20);

CREATE UNIQUE INDEX "sales_tenant_barcode_key"
  ON "sales" ("tenant_id", "barcode")
  WHERE "barcode" IS NOT NULL;
