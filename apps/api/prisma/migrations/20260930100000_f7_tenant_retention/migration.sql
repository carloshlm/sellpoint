-- F7-LIFECYCLE-10 — retención legal: un CLIENTE no se borra antes de su plazo.
--
-- Hasta hoy `purge_tenant()` solo exigía un negocio desactivado, y el service
-- pedía además 30 días de enfriamiento. Eso está bien para quien NUNCA pagó
-- (una prueba propia, un registro abandonado), pero no para un cliente: la ley
-- obliga a conservar lo suyo años después de que se va. Decisión de Carlos
-- (2026-09-21), contada desde la desactivación:
--
--   México ........... 10 años (Código de Comercio)
--   Canadá ...........  7 años (CRA)
--   Estados Unidos ...  7 años (IRS)
--   país desconocido . 10 años (equivocarse hacia guardar es barato)
--
-- «Cliente» = tiene al menos un pago REAL en `subscription_payments`:
-- registrado (no anulado), con importe y que no sea cortesía. No hay nada que
-- marcar a mano, y un pago de prueba tiene salida legítima y con rastro:
-- se anula, y el negocio queda libre.
--
-- La regla vive en la BASE a propósito: `purge_tenant()` es la ÚNICA
-- definición de «eliminar un negocio» y la llaman el API y los guiones de
-- `infrastructure/scripts/`. Si el candado estuviera solo en el service, un
-- guion se lo saltaría. La misma regla está en `@sellpoint/shared`
-- (`tenantRetentionYears`), que es con la que el backoffice pinta la fecha; el
-- spec `tenant-retention-schema.integration.spec.ts` ata las dos.

-- 1. La regla: años de retención de un negocio, o NULL si no es cliente.
--
-- SECURITY DEFINER porque `subscription_payments` tiene RLS y quien pregunta
-- (el rol de la app, desde el contexto de OTRO negocio) no vería los pagos.
CREATE OR REPLACE FUNCTION public.tenant_retention_years(p_tenant_id uuid)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM public.subscription_payments p
      WHERE p.tenant_id = p_tenant_id
        AND p.status = 'recorded' AND p.method <> 'courtesy' AND p.amount > 0
    ) THEN NULL
    ELSE (
      SELECT CASE upper(btrim(coalesce(t.country, '')))
        WHEN 'CA' THEN 7
        WHEN 'US' THEN 7
        ELSE 10
      END
      FROM public.tenants t WHERE t.id = p_tenant_id
    )
  END
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_retention_years(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_retention_years(uuid) TO sellpoint_app;
COMMENT ON FUNCTION public.tenant_retention_years(uuid) IS
  'Años que la ley obliga a conservar un negocio tras desactivarlo (F7-LIFECYCLE-10): MX 10, CA 7, US 7, otro 10. NULL si no es cliente (sin pagos reales). Misma regla que tenantRetentionYears() de @sellpoint/shared.';

-- 2. `purge_tenant()` la consulta antes de borrar. Es la función de
--    F7-LIFECYCLE-02 entera, con un cinturón más; lo demás no cambia.
CREATE OR REPLACE FUNCTION public.purge_tenant(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  negocio   record;
  tabla     text;
  tablas    int := 0;
  usuarios  int;
  ventas    int;
  anios     int;
BEGIN
  SELECT id, name, suspended_at INTO negocio FROM public.tenants WHERE id = p_tenant_id;
  IF negocio.id IS NULL THEN
    RAISE EXCEPTION 'purge_tenant: el negocio % no existe', p_tenant_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF negocio.suspended_at IS NULL THEN
    RAISE EXCEPTION 'purge_tenant: el negocio % (%) está ACTIVO; solo se elimina uno desactivado',
      negocio.name, p_tenant_id USING ERRCODE = 'check_violation';
  END IF;

  -- F7-LIFECYCLE-10: un cliente se conserva lo que pide la ley de su país.
  anios := public.tenant_retention_years(p_tenant_id);
  IF anios IS NOT NULL AND negocio.suspended_at + make_interval(years => anios) > now() THEN
    RAISE EXCEPTION 'purge_tenant: el negocio % (%) es CLIENTE (tiene pagos reales): retención legal de % años, no se elimina antes del %',
      negocio.name, p_tenant_id, anios,
      to_char(negocio.suspended_at + make_interval(years => anios), 'YYYY-MM-DD')
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO usuarios FROM public.users WHERE tenant_id = p_tenant_id;
  SELECT count(*) INTO ventas   FROM public.sales WHERE tenant_id = p_tenant_id;

  -- Local a la transacción: al hacer COMMIT (o ROLLBACK) vuelve a `origin`.
  PERFORM set_config('session_replication_role', 'replica', true);

  FOR tabla IN
    SELECT DISTINCT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    -- Solo tablas BASE: una VISTA con tenant_id (medical_clinic_sold_items)
    -- también sale acá y un DELETE sobre ella abortaría todo.
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      AND c.table_name <> 'tenants' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', tabla) USING p_tenant_id;
    tablas := tablas + 1;
  END LOOP;
  -- Con `replica` el CASCADE no corre: las huérfanas se limpian a mano.
  DELETE FROM public.user_roles       WHERE user_id NOT IN (SELECT id FROM public.users);
  DELETE FROM public.role_permissions WHERE role_id NOT IN (SELECT id FROM public.roles);
  DELETE FROM public.tenants WHERE id = p_tenant_id;

  PERFORM set_config('session_replication_role', 'origin', true);

  RETURN jsonb_build_object(
    'id', p_tenant_id, 'name', negocio.name, 'suspendedAt', negocio.suspended_at,
    'users', usuarios, 'sales', ventas, 'tables', tablas
  );
END
$$;

COMMENT ON FUNCTION public.purge_tenant(uuid) IS
  'Borra un negocio DESACTIVADO con todo lo suyo (F7-LIFECYCLE-02). Única definición de «eliminar un negocio»: la usan el API y infrastructure/scripts/. Exige suspended_at NOT NULL y, si es cliente, que ya haya pasado su retención legal (F7-LIFECYCLE-10, tenant_retention_years). SECURITY DEFINER porque session_replication_role es de superusuario.';
