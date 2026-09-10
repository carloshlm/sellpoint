-- F9-SUPPL-01 — el catálogo de proveedores.
--
-- Es CORE, no de un módulo: lo usan Compras (F9-PURCH) y Gastos (F9-EXP), y
-- mañana lo querrá la entrada de inventario, cuyo `reference` sigue siendo
-- texto libre (`stock_movements.reference`, deuda anotada ahí desde F3).
--
-- El molde es `customers` (F9-RECEP-02) cambiando persona por empresa:
-- `name` es la razón social o el nombre comercial, `tax_id` va normalizado y
-- validado por el país del negocio en el service (aquí solo cabe), el
-- teléfono es E.164 (misma regla que `tenants.phone` y `customers.phone`).
--
-- Sin UNIQUE en `tax_id`: un mismo registro fiscal repetido AVISA en el
-- formulario, no bloquea (mismo criterio que el contacto de clientes).
-- `attributes` nace sin motor de catálogos, igual que en `customers`.
-- `is_active` es para RETIRAR un proveedor sin borrarlo: borrar uno con
-- compras o gastos rebota por la FK (RESTRICT, jamás SET NULL).
--
-- La RLS va en ESTA migración, no en una posterior.

CREATE TABLE "suppliers" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"    UUID NOT NULL,
    "name"         TEXT NOT NULL,
    "tax_id"       VARCHAR(32),
    "contact_name" VARCHAR(120),
    "phone"        VARCHAR(20),
    "email"        TEXT,
    "address"      TEXT,
    "notes"        TEXT,
    "attributes"   JSONB NOT NULL DEFAULT '{}',
    "is_active"    BOOLEAN NOT NULL DEFAULT true,
    "created_by"   UUID,
    "updated_by"   UUID,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"   TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Se elige de un catálogo: se lee alfabético. El registro fiscal es la
-- búsqueda rápida al capturar una factura.
CREATE INDEX "suppliers_tenant_id_name_idx" ON "suppliers" ("tenant_id", "name");
CREATE INDEX "suppliers_tenant_id_tax_id_idx" ON "suppliers" ("tenant_id", "tax_id");
CREATE INDEX "suppliers_attributes_idx" ON "suppliers" USING GIN ("attributes" jsonb_path_ops);

-- El nombre no puede ser un espacio; el teléfono es E.164.
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_name_check" CHECK (btrim("name") <> '');
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9]\d{1,14}$');

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['suppliers']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)',
      t
    );
  END LOOP;
END
$$;
