-- F7-POS-03: "Vender sin existencias" es CONFIGURACIÓN del negocio, no solo
-- consecuencia del plan (decisión de Carlos, 2026-08-27). La regla efectiva
-- en la venta es: plan sin control de stock O este toggle prendido. En
-- Free/Basic queda implícita (sin control no hay bloqueo posible); en
-- Pro/Plus/Premium la decide el admin desde los ajustes del negocio —
-- default apagado = comportamiento estricto.
ALTER TABLE "tenants" ADD COLUMN "sell_without_stock" BOOLEAN NOT NULL DEFAULT false;
