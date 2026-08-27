-- F7-DB-02: el seed de referencia — 5 planes + 9 precios (3 publicados × 3
-- mercados). En la MIGRACIÓN y no en seed.ts (que es solo dev/demo), para
-- que llegue a todos los entornos por el pipeline — mismo patrón que
-- `20260821070000_f4_pos_permissions`.
--
-- Matriz decidida por Carlos el 2026-08-27 (ver IMPLEMENTACION.md Fase 7):
-- límites 3u/1a · 6u/4a · 20u/10a; cotizaciones desde Pro; lotes/caducidad,
-- campos y roles personalizados solo Plus; Basic SIN control de stock (vende
-- con saldo negativo); free = 10 ventas/día en solo-lectura. `free` es una
-- FILA para que el modo gratuito sea dato editable, no un `if` en el código.

INSERT INTO plans (code, name, description, sort_order, is_public, max_users, max_warehouses, daily_sales_limit, write_access, stock_control, features, updated_at) VALUES
  ('free', 'Free', 'Modo gratuito: consulta y hasta 10 ventas al día', 0, false, 1, 1, 10, false, false,
   '{"pos": true, "compositions": false, "quotes": false, "movements": false, "transfers": false, "lots": false, "custom_fields": false, "custom_roles": false, "reports": false, "reports_export": false}',
   CURRENT_TIMESTAMP),
  ('basic', 'Basic', 'POS completo sin control de inventario', 1, true, 3, 1, NULL, true, false,
   '{"pos": true, "compositions": false, "quotes": false, "movements": false, "transfers": false, "lots": false, "custom_fields": false, "custom_roles": false, "reports": false, "reports_export": false}',
   CURRENT_TIMESTAMP),
  ('pro', 'Pro', 'Inventario completo, cotizaciones y traspasos', 2, true, 6, 4, NULL, true, true,
   '{"pos": true, "compositions": true, "quotes": true, "movements": true, "transfers": true, "lots": false, "custom_fields": false, "custom_roles": false, "reports": true, "reports_export": true}',
   CURRENT_TIMESTAMP),
  ('plus', 'Plus', 'Todo: lotes y caducidades, personalización profunda', 3, true, 20, 10, NULL, true, true,
   '{"pos": true, "compositions": true, "quotes": true, "movements": true, "transfers": true, "lots": true, "custom_fields": true, "custom_roles": true, "reports": true, "reports_export": true}',
   CURRENT_TIMESTAMP),
  ('premium', 'Premium', 'Plus sin límites más desarrollo a la medida', 4, false, NULL, NULL, NULL, true, true,
   '{"pos": true, "compositions": true, "quotes": true, "movements": true, "transfers": true, "lots": true, "custom_fields": true, "custom_roles": true, "reports": true, "reports_export": true}',
   CURRENT_TIMESTAMP)
ON CONFLICT (code) DO NOTHING;

-- Precios por mercado (anual = mensual × 10, lo exige el CHECK):
-- MX $199/$349/$499 MXN · US $15/$29/$45 USD · CA $19/$39/$59 CAD.
INSERT INTO plan_prices (plan_id, country, currency, price_monthly, price_yearly, updated_at)
SELECT p.id, v.country, v.currency, v.monthly, v.monthly * 10, CURRENT_TIMESTAMP
FROM (VALUES
  ('basic', 'MX', 'MXN', 199.00::decimal),
  ('basic', 'US', 'USD',  15.00::decimal),
  ('basic', 'CA', 'CAD',  19.00::decimal),
  ('pro',   'MX', 'MXN', 349.00::decimal),
  ('pro',   'US', 'USD',  29.00::decimal),
  ('pro',   'CA', 'CAD',  39.00::decimal),
  ('plus',  'MX', 'MXN', 499.00::decimal),
  ('plus',  'US', 'USD',  45.00::decimal),
  ('plus',  'CA', 'CAD',  59.00::decimal)
) AS v(code, country, currency, monthly)
JOIN plans p ON p.code = v.code
ON CONFLICT (plan_id, country) DO NOTHING;
