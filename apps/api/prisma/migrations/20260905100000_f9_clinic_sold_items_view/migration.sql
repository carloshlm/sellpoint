-- F9-CLINIC-29 — lo vendido desde el Consultorio Médico, por ítem.
--
-- Una VISTA y no una tabla: los datos ya existen y son de la venta. Una tabla
-- paralela habría que escribirla al cobrar y corregirla al anular, y el día
-- que se desincronice nadie sabría cuál de las dos dice la verdad. Acá anular
-- una venta la saca del top sola, y renombrar un estudio no parte su historial
-- porque el enlace es por id, no por nombre.
--
-- `security_invoker = true`: la vista corre con los privilegios de QUIEN
-- consulta, así que la RLS de `sale_items`, `sales` y las tablas del módulo la
-- protege sin políticas propias. Hoy es la SEGUNDA barrera —las cuatro tablas
-- base llevan FORCE ROW LEVEL SECURITY, que aplica incluso al dueño de la
-- vista, y por eso quitar esta cláusula no abre ninguna fuga en los tests—,
-- pero es la que sigue en pie el día que alguien afloje el FORCE de una tabla.
--
-- El puente es `sale_items.source_ref` → `medical_clinic_order_lines.id`, que
-- el POS guarda como dos textos opacos: el punto de venta nunca sabe de
-- medicina. La misma forma sirve a la vertical siguiente.
CREATE VIEW medical_clinic_sold_items WITH (security_invoker = true) AS
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
  si.line_total
FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN medical_clinic_order_lines ol ON ol.id = si.source_ref
  JOIN medical_clinic_orders o ON o.id = ol.order_id
WHERE si.source_module = 'medical_clinic';

GRANT SELECT ON medical_clinic_sold_items TO sellpoint_app;
