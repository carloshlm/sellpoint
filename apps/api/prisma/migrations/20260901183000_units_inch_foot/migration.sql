-- Pulgada y Pie (Carlos, 2026-09-01): las dos primeras unidades imperiales de
-- longitud. Mismo molde que la siembra original (`20260816195528_units_master`):
-- la IDENTIDAD vive acá porque `products.base_unit` es FK contra esta tabla;
-- los FACTORES (1 in = 2.54 cm, 1 ft = 30.48 cm — definiciones exactas, no
-- medidas) viven en `@sellpoint/shared`, y el test de contrato
-- `units-master.integration.spec` falla si las dos fuentes divergen.
INSERT INTO "units" ("code", "name_es", "name_en", "category", "is_active") VALUES
  ('in', 'Pulgada', 'Inch', 'length', true),
  ('ft', 'Pie',     'Foot', 'length', true)
ON CONFLICT ("code") DO NOTHING;
