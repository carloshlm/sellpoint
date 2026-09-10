-- F9-EXP-02 — las categorías de gasto: tabla PROPIA, no el motor F2-CAT.
--
-- Basic (donde Gastos está incluido) no trae `custom_fields`, y el permiso
-- del motor sería `catalogs:*`: una categoría de gasto la administra quien
-- administra gastos. La tabla es chica a propósito: código estable, nombre,
-- orden y si sigue activa.
--
-- Las 18 de fábrica (Carlos, 2026-09-10) se siembran DOS veces por diseño:
-- `provision()` para los negocios nuevos y el backfill de abajo para los que
-- ya existían, en el idioma del negocio (`tenants.locale`). Nunca en diferido
-- dentro de un GET: sembrar al leer es una escritura escondida en una lectura.
-- La barrera `expense-categories-seed.spec.ts` exige que estos VALUES y
-- `EXPENSE_CATEGORY_SEED` (shared) digan exactamente lo mismo.
--
-- La RLS va en ESTA migración, no en una posterior.

CREATE TABLE "expense_categories" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"  UUID NOT NULL,
    "code"       VARCHAR(48) NOT NULL,
    "name"       VARCHAR(120) NOT NULL,
    "is_active"  BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT transaction_timestamp(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- El código identifica; el nombre se lee. Dos categorías con el mismo código
-- serían la misma con dos nombres.
CREATE UNIQUE INDEX "expense_categories_tenant_id_code_key" ON "expense_categories" ("tenant_id", "code");
CREATE INDEX "expense_categories_tenant_id_sort_order_name_idx"
  ON "expense_categories" ("tenant_id", "sort_order", "name");

ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_name_check" CHECK (btrim("name") <> '');
ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_code_check" CHECK ("code" ~ '^[a-z0-9]+(_[a-z0-9]+)*$');

-- ─────────────────────────────────────────────────────────────────────────
-- Aislamiento por tenant, desde el minuto cero
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_categories']
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

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill: los negocios que ya existen reciben las 18, en su idioma
-- ─────────────────────────────────────────────────────────────────────────
-- El negocio no tiene idioma propio: lo tiene cada usuario (`users.locale`).
-- El del negocio se toma del PRIMER usuario (el owner, que lo registró y
-- eligió el idioma en el alta) — el mismo criterio que `provision()`, que
-- siembra con `input.locale` del registro.
INSERT INTO "expense_categories" ("tenant_id", "code", "name", "sort_order", "updated_at")
SELECT t.id,
       v.code,
       CASE WHEN o.locale = 'en' THEN v.name_en ELSE v.name_es END,
       v.sort,
       transaction_timestamp()
FROM "tenants" t
LEFT JOIN LATERAL (
  SELECT u.locale FROM "users" u WHERE u.tenant_id = t.id ORDER BY u.created_at ASC LIMIT 1
) o ON true
CROSS JOIN (VALUES
    ('rent', 'Renta', 'Rent', 0),
    ('electricity', 'Luz', 'Electricity', 10),
    ('water', 'Agua', 'Water', 20),
    ('internet', 'Internet', 'Internet', 30),
    ('phone', 'Teléfono', 'Phone', 40),
    ('cleaning', 'Limpieza', 'Cleaning', 50),
    ('stationery', 'Papelería', 'Stationery', 60),
    ('maintenance', 'Mantenimiento', 'Maintenance', 70),
    ('repairs', 'Reparaciones', 'Repairs', 80),
    ('advertising', 'Publicidad', 'Advertising', 90),
    ('transport', 'Transporte', 'Transport', 100),
    ('fuel', 'Combustible', 'Fuel', 110),
    ('bank_fees', 'Comisiones bancarias', 'Bank fees', 120),
    ('professional_services', 'Servicios profesionales', 'Professional services', 130),
    ('software', 'Software y suscripciones', 'Software and subscriptions', 140),
    ('insurance', 'Seguros', 'Insurance', 150),
    ('payroll', 'Nómina', 'Payroll', 160),
    ('other', 'Otros', 'Other', 170)
) AS v(code, name_es, name_en, sort)
ON CONFLICT DO NOTHING;
