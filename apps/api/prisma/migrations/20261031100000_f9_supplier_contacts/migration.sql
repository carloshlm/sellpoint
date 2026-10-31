-- Contactos de proveedor (Carlos, 2026-10-31).
--
-- Dos cambios ADITIVOS, sin tocar una sola fila existente:
--
-- 1. `suppliers` gana el «Puesto / Cargo» del contacto 1 y la dirección
--    desglosada con la misma forma que la de Sucursales (F1-ADDR-03):
--    `address` sigue siendo la línea 1 («Calle y número»), así que la dirección
--    que ya tenía cada proveedor queda donde estaba. La región y el CP se
--    validan contra el país del negocio en el service, no aquí.
--
-- 2. `supplier_contacts`: los contactos ADICIONALES («Contacto 2», «Contacto
--    3»…). El contacto 1 se queda en las columnas de `suppliers` porque la
--    lista lo lee de ahí. `sort_order` es la posición que la persona les dio;
--    la edición reemplaza el conjunto completo.
--
-- Molde: las líneas de la orden de compra (`20260921110000_f9_po_model`):
-- hija con su propio `tenant_id` —lo exige `purge_tenant`, que borra por esa
-- columna con los CASCADE apagados—, FK al padre ON DELETE CASCADE y la RLS
-- canónica en ESTA migración. Los GRANTs a `sellpoint_app` NO se declaran: los
-- cubre el ALTER DEFAULT PRIVILEGES de `20260806172006_app_db_user`.

ALTER TABLE "suppliers"
  ADD COLUMN "job_title"     VARCHAR(120),
  ADD COLUMN "address_line2" VARCHAR(120),
  ADD COLUMN "city"          VARCHAR(120),
  ADD COLUMN "region"        VARCHAR(8),
  ADD COLUMN "postal_code"   VARCHAR(16);

CREATE TABLE "supplier_contacts" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"   UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "sort_order"  INTEGER NOT NULL,
    "name"        VARCHAR(120) NOT NULL,
    "phone"       VARCHAR(20),
    "email"       TEXT,
    "job_title"   VARCHAR(120),
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at"  TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_contacts" ADD CONSTRAINT "supplier_contacts_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Una posición por proveedor; y el proveedor trae sus contactos por su índice.
CREATE UNIQUE INDEX "supplier_contacts_supplier_id_sort_order_key"
  ON "supplier_contacts" ("supplier_id", "sort_order");
CREATE INDEX "supplier_contacts_tenant_id_supplier_id_idx"
  ON "supplier_contacts" ("tenant_id", "supplier_id");

-- Las mismas reglas que el contacto 1: el nombre no es un espacio y el
-- teléfono es E.164 (copia exacta de `suppliers_phone_check`).
ALTER TABLE "supplier_contacts"
  ADD CONSTRAINT "supplier_contacts_name_check" CHECK (btrim("name") <> '');
ALTER TABLE "supplier_contacts"
  ADD CONSTRAINT "supplier_contacts_phone_check" CHECK ("phone" IS NULL OR "phone" ~ '^\+[1-9]\d{1,14}$');

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['supplier_contacts']
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
