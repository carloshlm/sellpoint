-- F9-MOD-02: qué módulo avanzado tiene activo cada negocio, por encima de su
-- plan. Es una TABLA y no un JSONB en `tenant_subscriptions` porque guarda
-- QUIÉN lo activó y CUÁNDO, y porque sobrevive a un cambio de plan sin que
-- nadie tenga que acordarse de preservarla.
--
-- `module_key` no lleva CHECK: el catálogo de módulos vive en código
-- (`MODULE_KEYS` en packages/shared) y el resolver descarta con WARN las
-- claves que ya no existan. Un módulo retirado no debe reventar la lectura
-- de la suscripción de nadie.

CREATE TABLE "tenant_modules" (
  "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  UUID NOT NULL,
  "module_key" VARCHAR(32) NOT NULL,
  "enabled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "enabled_by" UUID,
  "notes"      TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_modules_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Un módulo se activa una vez por negocio: activar dos veces es un upsert,
-- no una segunda fila.
CREATE UNIQUE INDEX "tenant_modules_tenant_id_module_key_key"
  ON "tenant_modules"("tenant_id", "module_key");

-- La RLS canónica va en ESTA migración, no en una posterior (texto idéntico
-- al de las demás tablas: es un contrato).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_modules'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) '
      'WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- La QUINTA tabla del bypass acotado del backoffice (F7-DB-05): la lista de
-- negocios necesita leer los módulos de TODOS en una sola query. Misma
-- policy que en las 4 tablas de billing; las tablas de negocio siguen
-- cerradas desde ese contexto.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_modules'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS billing_admin_bypass ON %I', t);
    EXECUTE format(
      'CREATE POLICY billing_admin_bypass ON %I FOR ALL '
      || 'USING (current_setting(''app.billing_admin'', true) = ''on'') '
      || 'WITH CHECK (current_setting(''app.billing_admin'', true) = ''on'')',
      t
    );
  END LOOP;
END $$;
