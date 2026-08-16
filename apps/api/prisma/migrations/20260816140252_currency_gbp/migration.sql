-- Soporte de libra esterlina (GBP) — decisión de Carlos, 2026-08-16.
-- Mismo patrón que 20260816133649_currency_cad y 20260816135018_currency_eur:
-- el CHECK se recrea (Postgres no permite alterarlo en sitio) sobre un set que
-- es superconjunto del anterior, así que ningún dato existente lo viola; y la
-- fila del catálogo viaja en la migración, no en el seed, para llegar a TODOS
-- los entornos por el pipeline.

ALTER TABLE "tenants" DROP CONSTRAINT "tenants_currency_check";
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_currency_check" CHECK ("currency" IN ('MXN', 'USD', 'CAD', 'EUR', 'GBP'));

INSERT INTO "currencies" ("code", "symbol", "decimals", "name_es", "name_en", "is_active") VALUES
  ('GBP', '£', 2, 'Libra esterlina', 'Pound sterling', true)
ON CONFLICT ("code") DO NOTHING;
