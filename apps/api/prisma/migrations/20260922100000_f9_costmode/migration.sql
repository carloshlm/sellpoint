-- F9-COSTMODE-02 — el ajuste del negocio «¿los costos se capturan con el
-- impuesto adentro?», hermano de `tax_mode` (que responde lo mismo del PRECIO).
--
-- El costo se GUARDA como se captura, en la base que diga esta columna: lo
-- que dice la factura antes de IVA/GST (`excluded`) o lo que se pagó en
-- mostrador (`included`). El NETO se materializa solo donde se computa
-- dinero: la compra (`purchase_lines.unit_cost_net`), la entrada al
-- confirmar y la venta. Utilidad, promedio ponderado y valorización ya eran
-- netos: con este ajuste lo son por construcción y no por convención.
--
-- Default `excluded` para TODOS los mercados, México incluido (el CFDI trae
-- el valor unitario sin IVA y el IVA es acreditable): es exactamente lo que
-- el sistema venía asumiendo, así que no hay backfill — ningún negocio
-- cambia de base al aplicar esta migración. El catálogo de valores vive en
-- `packages/shared/src/tax.ts`; el default por país en `tax-defaults.ts`.
ALTER TABLE "tenants"
  ADD COLUMN "cost_tax_mode" VARCHAR(8) NOT NULL DEFAULT 'excluded';
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_cost_tax_mode_check"
  CHECK ("cost_tax_mode" IN ('included', 'excluded'));
