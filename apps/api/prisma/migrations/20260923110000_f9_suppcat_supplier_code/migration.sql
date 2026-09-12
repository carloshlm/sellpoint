-- F9-SUPPCAT-03 — el CÓDIGO del proveedor (Carlos, 2026-09-12): «el catálogo
-- de Proveedores también debe tener su campo Código como los demás». Como el
-- sku del producto y el code del almacén: la llave que la persona ve en
-- pantalla, por la que busca y por la que casaría una planilla. Único por
-- negocio, en MAYÚSCULAS (F9-SUPPCAT-01).
--
-- ── El backfill ─────────────────────────────────────────────────────────
--
-- La columna nace NOT NULL, así que lo que ya existe recibe un código antes
-- de la restricción: `PROV-001`, `PROV-002`… por negocio, en el orden en que
-- se crearon. Mismo patrón que `ALM-NNN` (20260901210000_warehouse_code) y
-- que el service usa cuando un alta llega sin código: lo heredado y lo
-- generado se leen igual.
ALTER TABLE "suppliers" ADD COLUMN "code" VARCHAR(64);

UPDATE "suppliers" s
   SET "code" = 'PROV-' || lpad(n.pos::text, 3, '0')
  FROM (
    SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS pos
      FROM "suppliers"
  ) n
 WHERE n.id = s.id;

ALTER TABLE "suppliers" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");

COMMENT ON COLUMN "suppliers"."code" IS
  'Código estándar, único por negocio y en mayúsculas: la llave visible del proveedor (PROV-NNN si el alta no trae uno).';
