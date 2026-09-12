-- F9-SUPPCAT-02 — los códigos de catálogo que ya existen suben a MAYÚSCULAS
-- (Carlos, 2026-09-12: «todos los campos de código sean solo mayúsculas»).
--
-- ── Por qué migrar y no solo normalizar hacia adelante ──────────────────
--
-- Desde F9-SUPPCAT-01 el API guarda todo código en mayúsculas. Pero los
-- índices únicos de `sku`/`code` distinguen mayúsculas: si un producto quedó
-- guardado como `abc` y mañana llega una planilla con `abc`, el importador lo
-- normaliza a `ABC`, no lo encuentra, y CREA un duplicado en vez de
-- actualizar. Los datos viejos tienen que hablar el mismo idioma que los
-- nuevos, y eso se hace una vez, acá.
--
-- ── Colisiones ──────────────────────────────────────────────────────────
--
-- `kg` y `KG` en el mismo catálogo no pueden subir los dos. Regla aprobada
-- por Carlos: la fila MÁS NUEVA (`created_at, id`) recibe el sufijo `-2`
-- (`-3`… si son más), y el cambio queda en `audit_logs` con la acción
-- `catalogs.code_uppercased` para que se pueda rastrear qué se renombró. La
-- migración no falla a mitad del deploy por un dato que no se puede ver desde
-- aquí. Riesgo residual, con nombre: que `KG-2` ya existiera como código
-- propio — improbable, y en ese caso el índice único detiene la migración
-- con un error legible en vez de pisar nada.
--
-- Todo es SQL de conjunto (sin bloques DO): cada sentencia termina en `;` y
-- el spec de integración las reproduce una por una. Idempotente: la segunda
-- corrida no encuentra colisiones ni minúsculas y no toca nada.
--
-- `expense_categories.code` queda FUERA: es snake_case interno con CHECK de
-- minúsculas y desde el 2026-09-12 ya no se muestra.

-- ── products.sku (único por tenant) ─────────────────────────────────────
WITH ranked AS (
  SELECT id, tenant_id, sku,
         row_number() OVER (PARTITION BY tenant_id, upper(sku) ORDER BY created_at, id) AS rn
    FROM "products"
), renamed AS (
  UPDATE "products" p
     SET sku = upper(r.sku) || '-' || r.rn
    FROM ranked r
   WHERE r.id = p.id AND r.rn > 1
  RETURNING p.id, p.tenant_id, r.sku AS antes, p.sku AS despues
)
INSERT INTO "audit_logs" (tenant_id, action, resource_type, resource_id, before, after)
SELECT tenant_id, 'catalogs.code_uppercased', 'product', id::text,
       jsonb_build_object('sku', antes), jsonb_build_object('sku', despues)
  FROM renamed;

UPDATE "products" SET sku = upper(sku) WHERE sku <> upper(sku);

-- ── services.code (único por tenant) ────────────────────────────────────
WITH ranked AS (
  SELECT id, tenant_id, code,
         row_number() OVER (PARTITION BY tenant_id, upper(code) ORDER BY created_at, id) AS rn
    FROM "services"
), renamed AS (
  UPDATE "services" s
     SET code = upper(r.code) || '-' || r.rn
    FROM ranked r
   WHERE r.id = s.id AND r.rn > 1
  RETURNING s.id, s.tenant_id, r.code AS antes, s.code AS despues
)
INSERT INTO "audit_logs" (tenant_id, action, resource_type, resource_id, before, after)
SELECT tenant_id, 'catalogs.code_uppercased', 'service', id::text,
       jsonb_build_object('code', antes), jsonb_build_object('code', despues)
  FROM renamed;

UPDATE "services" SET code = upper(code) WHERE code <> upper(code);

-- ── warehouses.code (único por tenant) ──────────────────────────────────
WITH ranked AS (
  SELECT id, tenant_id, code,
         row_number() OVER (PARTITION BY tenant_id, upper(code) ORDER BY created_at, id) AS rn
    FROM "warehouses"
), renamed AS (
  UPDATE "warehouses" w
     SET code = upper(r.code) || '-' || r.rn
    FROM ranked r
   WHERE r.id = w.id AND r.rn > 1
  RETURNING w.id, w.tenant_id, r.code AS antes, w.code AS despues
)
INSERT INTO "audit_logs" (tenant_id, action, resource_type, resource_id, before, after)
SELECT tenant_id, 'catalogs.code_uppercased', 'warehouse', id::text,
       jsonb_build_object('code', antes), jsonb_build_object('code', despues)
  FROM renamed;

UPDATE "warehouses" SET code = upper(code) WHERE code <> upper(code);

-- ── catalog_records.code (único por CATÁLOGO) ───────────────────────────
WITH ranked AS (
  SELECT id, tenant_id, catalog_id, code,
         row_number() OVER (PARTITION BY catalog_id, upper(code) ORDER BY created_at, id) AS rn
    FROM "catalog_records"
), renamed AS (
  UPDATE "catalog_records" c
     SET code = upper(r.code) || '-' || r.rn
    FROM ranked r
   WHERE r.id = c.id AND r.rn > 1
  RETURNING c.id, c.tenant_id, r.code AS antes, c.code AS despues
)
INSERT INTO "audit_logs" (tenant_id, action, resource_type, resource_id, before, after)
SELECT tenant_id, 'catalogs.code_uppercased', 'catalog_record', id::text,
       jsonb_build_object('code', antes), jsonb_build_object('code', despues)
  FROM renamed;

UPDATE "catalog_records" SET code = upper(code) WHERE code <> upper(code);

-- ── estudios (el DTO ya subía a mayúsculas; por si quedó alguno cargado por otro camino) ──
WITH ranked AS (
  SELECT id, tenant_id, code,
         row_number() OVER (PARTITION BY tenant_id, upper(code) ORDER BY created_at, id) AS rn
    FROM "medical_clinic_lab_studies"
), renamed AS (
  UPDATE "medical_clinic_lab_studies" e
     SET code = upper(r.code) || '-' || r.rn
    FROM ranked r
   WHERE r.id = e.id AND r.rn > 1
  RETURNING e.id, e.tenant_id, r.code AS antes, e.code AS despues
)
INSERT INTO "audit_logs" (tenant_id, action, resource_type, resource_id, before, after)
SELECT tenant_id, 'catalogs.code_uppercased', 'medical_clinic_lab_study', id::text,
       jsonb_build_object('code', antes), jsonb_build_object('code', despues)
  FROM renamed;

UPDATE "medical_clinic_lab_studies" SET code = upper(code) WHERE code <> upper(code);

WITH ranked AS (
  SELECT id, tenant_id, code,
         row_number() OVER (PARTITION BY tenant_id, upper(code) ORDER BY created_at, id) AS rn
    FROM "medical_clinic_diagnostic_studies"
), renamed AS (
  UPDATE "medical_clinic_diagnostic_studies" e
     SET code = upper(r.code) || '-' || r.rn
    FROM ranked r
   WHERE r.id = e.id AND r.rn > 1
  RETURNING e.id, e.tenant_id, r.code AS antes, e.code AS despues
)
INSERT INTO "audit_logs" (tenant_id, action, resource_type, resource_id, before, after)
SELECT tenant_id, 'catalogs.code_uppercased', 'medical_clinic_diagnostic_study', id::text,
       jsonb_build_object('code', antes), jsonb_build_object('code', despues)
  FROM renamed;

UPDATE "medical_clinic_diagnostic_studies" SET code = upper(code) WHERE code <> upper(code);
