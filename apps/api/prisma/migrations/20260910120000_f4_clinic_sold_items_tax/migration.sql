-- F4-TAX-20 — la vista de lo vendido desde el consultorio gana el impuesto
-- de la línea, para que el top del módulo reste lo que no es ingreso.
--
-- `CREATE OR REPLACE VIEW` solo admite AGREGAR columnas al final: por eso
-- `tax_amount` va última y el resto queda en el mismo orden que en
-- `20260905100000_f9_clinic_sold_items_view`. El GRANT se repite a propósito:
-- reemplazar la vista conserva los privilegios, pero quien lea esta migración
-- sola tiene que ver que la app la consulta con su rol.
CREATE OR REPLACE VIEW medical_clinic_sold_items WITH (security_invoker = true) AS
SELECT
  si.tenant_id,
  si.sale_id,
  si.id            AS sale_item_id,
  s.folio          AS sale_folio,
  s.created_at     AS sold_at,
  s.status         AS sale_status,
  s.warehouse_id,
  ol.order_id,
  ol.order_kind,
  o.folio          AS order_folio,
  CASE
    WHEN ol.product_id IS NOT NULL THEN 'medication'
    WHEN ol.lab_study_id IS NOT NULL THEN 'lab_study'
    ELSE 'diagnostic_study'
  END              AS item_kind,
  ol.product_id,
  ol.lab_study_id,
  ol.diagnostic_study_id,
  -- El texto que se vendió, congelado en la línea de la orden.
  ol.description,
  si.quantity,
  si.unit_price,
  si.line_total,
  -- F4-TAX-20: el impuesto que viaja dentro de line_total.
  si.tax_amount
FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN medical_clinic_order_lines ol ON ol.id = si.source_ref
  JOIN medical_clinic_orders o ON o.id = ol.order_id
WHERE si.source_module = 'medical_clinic';

GRANT SELECT ON medical_clinic_sold_items TO sellpoint_app;
