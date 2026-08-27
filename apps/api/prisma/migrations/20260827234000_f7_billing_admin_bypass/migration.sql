-- F7-DB-05: la SEGUNDA policy de las 4 tablas de billing — el bypass ACOTADO
-- del backoffice del dueño y del cron.
--
-- No se toca la policy canónica `tenant_isolation` (su texto se replica
-- idéntico en 20+ tablas y es un contrato). Postgres evalúa las policies
-- PERMISSIVE con OR: la fila pasa si la ve el tenant O si el GUC de billing
-- está prendido.
--
-- El GUC `app.billing_admin` solo lo prende
-- `PrismaService.withBillingAdminContext()` (regla dura hermana de AD-1:
-- `set_config` fuera de PrismaService está prohibido). Y el bypass NO es
-- global A PROPÓSITO: estas policies existen únicamente en las 4 tablas de
-- billing — un SELECT a `sales` o `warehouses` desde ese contexto sigue
-- devolviendo cero filas. Un bug en el backoffice no puede leer datos de
-- negocio ajenos; fijado por test de integración.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_subscriptions', 'subscription_payments', 'tenant_discounts', 'billing_notifications'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS billing_admin_bypass ON %I', t);
    EXECUTE format(
      'CREATE POLICY billing_admin_bypass ON %I FOR ALL '
      || 'USING (current_setting(''app.billing_admin'', true) = ''on'') '
      || 'WITH CHECK (current_setting(''app.billing_admin'', true) = ''on'')',
      t
    );
  END LOOP;
END $$;
