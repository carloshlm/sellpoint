-- Soporte de euro (EUR) — decisión de Carlos, 2026-08-16.
-- Mismo patrón que 20260816133649_currency_cad: el CHECK se recrea (Postgres
-- no permite alterarlo en sitio) sobre un set que es superconjunto del
-- anterior, así que ningún dato existente lo viola; y la fila del catálogo
-- viaja en la migración, no en el seed, para llegar a TODOS los entornos.

ALTER TABLE "tenants" DROP CONSTRAINT "tenants_currency_check";
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_currency_check" CHECK ("currency" IN ('MXN', 'USD', 'CAD', 'EUR'));

INSERT INTO "currencies" ("code", "symbol", "decimals", "name_es", "name_en", "is_active") VALUES
  ('EUR', '€', 2, 'Euro', 'Euro', true)
ON CONFLICT ("code") DO NOTHING;
