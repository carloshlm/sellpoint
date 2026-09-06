-- F7 — La tarifa de Canadá y los reportes en el plan Básico (Carlos, 2026-09-06).
--
-- ── Precios ──────────────────────────────────────────────────────────────
-- El mercado canadiense de POS arranca en $49 CAD (Erply) y sube a $60
-- (Square Retail Plus), $69 (TouchBistro) y $89 (Shopify POS Pro, POR LOCAL).
-- Los $19/$39/$59 que sembró `20260827231000_f7_plans_seed` quedaban ~65% por
-- debajo del mercado: eso no compra clientes, regala margen y en Canadá un
-- precio así levanta la sospecha de software flojo. 29/49/89 deja cada
-- escalón por debajo de su rival directo (el Pro a $59 le gana a Square por
-- un dólar, que es el lado correcto de la comparación que el prospecto sí
-- hace) y mantiene la escalera pareja.
--
-- El CHECK `plan_prices_yearly_is_ten_months` exige anual = mensual × 10.
UPDATE plan_prices
SET price_monthly = v.monthly,
    price_yearly  = v.monthly * 10,
    updated_at    = CURRENT_TIMESTAMP
FROM (VALUES
  ('basic', 29.00::decimal),
  ('pro',   49.00::decimal),
  ('plus',  89.00::decimal)
) AS v(code, monthly)
WHERE plan_prices.country = 'CA'
  AND plan_prices.plan_id = (SELECT id FROM plans WHERE plans.code = v.code);

-- ── Reportes en el Básico ────────────────────────────────────────────────
-- Square y Loyverse regalan reportes de ventas y exportación en su plan
-- GRATUITO: un plan de entrada de pago que no los tiene no compite en
-- Canadá. Y el flag nunca restringió nada — `ReportsController` no lleva
-- `@RequiresFeature("reports")` —, así que esto no abre una puerta nueva:
-- alinea la vitrina de planes con lo que el producto YA hacía, y deja de
-- mostrarle al prospecto un ❌ sobre algo que sí recibe.
--
-- La frontera con Pro sigue siendo el INVENTARIO (`stock_control`,
-- `movements`, `transfers`, `quotes`), no la lectura de las propias ventas.
--
-- `||` fusiona sobre el JSONB y conserva las otras ocho keys de la matriz,
-- que `planFeaturesSchema` valida como `strictObject` al leer la fila.
UPDATE plans
SET features   = features || '{"reports": true, "reports_export": true}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'basic';
