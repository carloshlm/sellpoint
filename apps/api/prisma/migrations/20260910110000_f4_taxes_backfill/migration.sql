-- F4-TAX-05 — Backfill de impuestos para los negocios que ya existían.
--
-- GENERADO por prisma/tax-backfill-sql.ts desde `resolveTaxDefaults` (shared).
-- No se edita a mano: el spec tax-backfill.integration.spec.ts compara este
-- archivo con lo que el generador emite.
--
-- Idempotente: solo toca negocios SIN grupos (NOT EXISTS). Los documentos
-- históricos quedan con tax_mode = 'included', tax_total = 0 y
-- tax_amount = 0 por DEFAULT de F4-TAX-04: se leen correctos sin tocarlos.
--
-- Sin región (los negocios existentes no la tienen): Canadá recibe solo lo
-- federal y la tarjeta de impuestos pedirá la provincia; Estados Unidos nace
-- sin impuesto. México: IVA 16% incluido, el precio no cambia.

-- 1) El modo, solo donde el precio NO trae el impuesto.
UPDATE tenants t
   SET tax_mode = 'excluded'
 WHERE t.country IN ('US', 'CA')
   AND NOT EXISTS (SELECT 1 FROM tax_groups g WHERE g.tenant_id = t.id);

-- 2) Los grupos y sus componentes, por país curado.
WITH nuevos AS (
  INSERT INTO tax_groups (tenant_id, code, name, is_default, is_active, sort_order, updated_at)
  SELECT t.id, v.code, v.name, v.is_default, true, v.sort_order, now()
    FROM tenants t
    JOIN (VALUES
      ('MX', 'VAT16', 'IVA 16%', true, 0),
      ('MX', 'VAT8', 'IVA 8% frontera', false, 1),
      ('MX', 'VAT0', 'IVA 0%', false, 2),
      ('MX', 'EXEMPT', 'Exento', false, 3),
      ('US', 'SALES_TAX', 'Sales tax 0%', false, 0),
      ('US', 'NO_TAX', 'No tax', true, 1),
      ('CA', 'GST_ONLY', 'GST 5%', true, 0),
      ('CA', 'ZERO', 'Zero-rated 0%', false, 1),
      ('CA', 'EXEMPT', 'Exempt', false, 2),
      ('PT', 'VAT23', 'IVA 23%', true, 0),
      ('PT', 'VAT0', 'IVA 0%', false, 1),
      ('PT', 'EXEMPT', 'Exento', false, 2),
      ('ES', 'VAT21', 'IVA 21%', true, 0),
      ('ES', 'VAT0', 'IVA 0%', false, 1),
      ('ES', 'EXEMPT', 'Exento', false, 2),
      ('FR', 'VAT20', 'TVA 20%', true, 0),
      ('FR', 'VAT0', 'TVA 0%', false, 1),
      ('FR', 'EXEMPT', 'Exento', false, 2),
      ('IT', 'VAT22', 'IVA 22%', true, 0),
      ('IT', 'VAT0', 'IVA 0%', false, 1),
      ('IT', 'EXEMPT', 'Exento', false, 2),
      ('DE', 'VAT19', 'MwSt 19%', true, 0),
      ('DE', 'VAT0', 'MwSt 0%', false, 1),
      ('DE', 'EXEMPT', 'Exento', false, 2),
      ('GB', 'VAT20', 'VAT 20%', true, 0),
      ('GB', 'VAT0', 'VAT 0%', false, 1),
      ('GB', 'EXEMPT', 'Exempt', false, 2),
      ('BZ', 'VAT12_5', 'GST 12.5%', true, 0),
      ('BZ', 'VAT0', 'GST 0%', false, 1),
      ('BZ', 'EXEMPT', 'Exento', false, 2),
      ('CR', 'VAT13', 'IVA 13%', true, 0),
      ('CR', 'VAT0', 'IVA 0%', false, 1),
      ('CR', 'EXEMPT', 'Exento', false, 2),
      ('SV', 'VAT13', 'IVA 13%', true, 0),
      ('SV', 'VAT0', 'IVA 0%', false, 1),
      ('SV', 'EXEMPT', 'Exento', false, 2),
      ('GT', 'VAT12', 'IVA 12%', true, 0),
      ('GT', 'VAT0', 'IVA 0%', false, 1),
      ('GT', 'EXEMPT', 'Exento', false, 2),
      ('HN', 'VAT15', 'ISV 15%', true, 0),
      ('HN', 'VAT0', 'ISV 0%', false, 1),
      ('HN', 'EXEMPT', 'Exento', false, 2),
      ('NI', 'VAT15', 'IVA 15%', true, 0),
      ('NI', 'VAT0', 'IVA 0%', false, 1),
      ('NI', 'EXEMPT', 'Exento', false, 2),
      ('PA', 'VAT7', 'ITBMS 7%', true, 0),
      ('PA', 'VAT0', 'ITBMS 0%', false, 1),
      ('PA', 'EXEMPT', 'Exento', false, 2),
      ('AR', 'VAT21', 'IVA 21%', true, 0),
      ('AR', 'VAT0', 'IVA 0%', false, 1),
      ('AR', 'EXEMPT', 'Exento', false, 2),
      ('BO', 'VAT13', 'IVA 13%', true, 0),
      ('BO', 'VAT0', 'IVA 0%', false, 1),
      ('BO', 'EXEMPT', 'Exento', false, 2),
      ('BR', 'NO_TAX', 'Sem imposto', true, 0),
      ('BR', 'EXEMPT', 'Isento', false, 1),
      ('CL', 'VAT19', 'IVA 19%', true, 0),
      ('CL', 'VAT0', 'IVA 0%', false, 1),
      ('CL', 'EXEMPT', 'Exento', false, 2),
      ('CO', 'VAT19', 'IVA 19%', true, 0),
      ('CO', 'VAT0', 'IVA 0%', false, 1),
      ('CO', 'EXEMPT', 'Exento', false, 2),
      ('EC', 'VAT15', 'IVA 15%', true, 0),
      ('EC', 'VAT0', 'IVA 0%', false, 1),
      ('EC', 'EXEMPT', 'Exento', false, 2),
      ('PY', 'VAT10', 'IVA 10%', true, 0),
      ('PY', 'VAT0', 'IVA 0%', false, 1),
      ('PY', 'EXEMPT', 'Exento', false, 2),
      ('PE', 'VAT18', 'IGV 18%', true, 0),
      ('PE', 'VAT0', 'IGV 0%', false, 1),
      ('PE', 'EXEMPT', 'Exento', false, 2),
      ('UY', 'VAT22', 'IVA 22%', true, 0),
      ('UY', 'VAT0', 'IVA 0%', false, 1),
      ('UY', 'EXEMPT', 'Exento', false, 2),
      ('VE', 'VAT16', 'IVA 16%', true, 0),
      ('VE', 'VAT0', 'IVA 0%', false, 1),
      ('VE', 'EXEMPT', 'Exento', false, 2)
    ) AS v(country, code, name, is_default, sort_order) ON v.country = t.country
   WHERE NOT EXISTS (SELECT 1 FROM tax_groups g WHERE g.tenant_id = t.id)
  RETURNING id, tenant_id, code
)
INSERT INTO tax_rates (tenant_id, tax_group_id, code, name, rate, sort_order)
SELECT n.tenant_id, n.id, r.code, r.name, r.rate, r.sort_order
  FROM nuevos n
  JOIN tenants t ON t.id = n.tenant_id
  JOIN (VALUES
    ('MX', 'VAT16', 'VAT', 'IVA 16%', 16, 0),
    ('MX', 'VAT8', 'VAT', 'IVA 8%', 8, 0),
    ('MX', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('US', 'SALES_TAX', 'SALES_TAX', 'Sales tax 0%', 0, 0),
    ('CA', 'GST_ONLY', 'GST', 'GST 5%', 5, 0),
    ('CA', 'ZERO', 'GST', 'GST 0%', 0, 0),
    ('PT', 'VAT23', 'VAT', 'IVA 23%', 23, 0),
    ('PT', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('ES', 'VAT21', 'VAT', 'IVA 21%', 21, 0),
    ('ES', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('FR', 'VAT20', 'VAT', 'TVA 20%', 20, 0),
    ('FR', 'VAT0', 'VAT', 'TVA 0%', 0, 0),
    ('IT', 'VAT22', 'VAT', 'IVA 22%', 22, 0),
    ('IT', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('DE', 'VAT19', 'VAT', 'MwSt 19%', 19, 0),
    ('DE', 'VAT0', 'VAT', 'MwSt 0%', 0, 0),
    ('GB', 'VAT20', 'VAT', 'VAT 20%', 20, 0),
    ('GB', 'VAT0', 'VAT', 'VAT 0%', 0, 0),
    ('BZ', 'VAT12_5', 'VAT', 'GST 12.5%', 12.5, 0),
    ('BZ', 'VAT0', 'VAT', 'GST 0%', 0, 0),
    ('CR', 'VAT13', 'VAT', 'IVA 13%', 13, 0),
    ('CR', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('SV', 'VAT13', 'VAT', 'IVA 13%', 13, 0),
    ('SV', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('GT', 'VAT12', 'VAT', 'IVA 12%', 12, 0),
    ('GT', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('HN', 'VAT15', 'VAT', 'ISV 15%', 15, 0),
    ('HN', 'VAT0', 'VAT', 'ISV 0%', 0, 0),
    ('NI', 'VAT15', 'VAT', 'IVA 15%', 15, 0),
    ('NI', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('PA', 'VAT7', 'VAT', 'ITBMS 7%', 7, 0),
    ('PA', 'VAT0', 'VAT', 'ITBMS 0%', 0, 0),
    ('AR', 'VAT21', 'VAT', 'IVA 21%', 21, 0),
    ('AR', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('BO', 'VAT13', 'VAT', 'IVA 13%', 13, 0),
    ('BO', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('CL', 'VAT19', 'VAT', 'IVA 19%', 19, 0),
    ('CL', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('CO', 'VAT19', 'VAT', 'IVA 19%', 19, 0),
    ('CO', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('EC', 'VAT15', 'VAT', 'IVA 15%', 15, 0),
    ('EC', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('PY', 'VAT10', 'VAT', 'IVA 10%', 10, 0),
    ('PY', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('PE', 'VAT18', 'VAT', 'IGV 18%', 18, 0),
    ('PE', 'VAT0', 'VAT', 'IGV 0%', 0, 0),
    ('UY', 'VAT22', 'VAT', 'IVA 22%', 22, 0),
    ('UY', 'VAT0', 'VAT', 'IVA 0%', 0, 0),
    ('VE', 'VAT16', 'VAT', 'IVA 16%', 16, 0),
    ('VE', 'VAT0', 'VAT', 'IVA 0%', 0, 0)
  ) AS r(country, group_code, code, name, rate, sort_order)
    ON r.country = t.country AND r.group_code = n.code;

-- 3) El resto (sin país, o país no curado): sin impuesto, precio final.
INSERT INTO tax_groups (tenant_id, code, name, is_default, is_active, sort_order, updated_at)
SELECT t.id, 'NO_TAX', 'Sin impuesto 0%', true, true, 0, now()
  FROM tenants t
 WHERE NOT EXISTS (SELECT 1 FROM tax_groups g WHERE g.tenant_id = t.id);
