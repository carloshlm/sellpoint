-- Soporte de dólar canadiense (CAD) — decisión de Carlos, 2026-08-16.
-- Dos piezas, ambas idempotentes-seguras sobre datos reales:
--   1. El CHECK de tenants.currency se amplía a ('MXN','USD','CAD'). DROP +
--      ADD porque Postgres no permite alterar un CHECK en sitio. Ningún dato
--      existente viola el set nuevo (es un superconjunto del anterior).
--   2. Fila CAD en el catálogo currencies (mismo patrón que la migración
--      20260806173635_currencies_master: INSERT en migración, no en seed,
--      para que llegue a TODOS los entornos por el pipeline).

ALTER TABLE "tenants" DROP CONSTRAINT "tenants_currency_check";
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_currency_check" CHECK ("currency" IN ('MXN', 'USD', 'CAD'));

INSERT INTO "currencies" ("code", "symbol", "decimals", "name_es", "name_en", "is_active") VALUES
  ('CAD', '$', 2, 'Dólar canadiense', 'Canadian dollar', true)
ON CONFLICT ("code") DO NOTHING;
