-- El CÓDIGO estándar del almacén (Carlos, 2026-09-01): como el sku del
-- producto y el code del servicio, la llave que la persona ve en pantalla y
-- por la que casa la planilla de importación. Único por negocio.
--
-- ── El backfill ─────────────────────────────────────────────────────────
--
-- La columna nace NOT NULL, así que lo que ya existe recibe un código antes
-- de la restricción: `ALM-001`, `ALM-002`… por negocio, en el orden en que
-- se crearon (el primero de cada tenant es el «Almacén Central» del
-- onboarding, que así queda como ALM-001). El mismo patrón que el service
-- usa cuando un alta llega sin código, para que lo generado y lo heredado
-- se lean igual.
ALTER TABLE "warehouses" ADD COLUMN "code" VARCHAR(64);

UPDATE "warehouses" w
   SET "code" = 'ALM-' || lpad(n.pos::text, 3, '0')
  FROM (
    SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS pos
      FROM "warehouses"
  ) n
 WHERE n.id = w.id;

ALTER TABLE "warehouses" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "warehouses_tenant_id_code_key" ON "warehouses"("tenant_id", "code");

COMMENT ON COLUMN "warehouses"."code" IS
  'Código estándar, único por negocio: la llave visible del almacén y la del match de la importación por planilla.';
