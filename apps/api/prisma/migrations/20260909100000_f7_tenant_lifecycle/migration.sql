-- F7-LIFECYCLE-02 — el ciclo de vida de un negocio: desactivar (reversible,
-- con fecha, quién y motivo) y eliminar (irreversible, solo desde desactivado).
--
-- 1. Estado en `tenants`. Sin tabla nueva: es UN dato del negocio, y quien
--    lista negocios lo lee sin un JOIN. El CHECK ata fecha y motivo: no hay
--    desactivación sin explicación ni motivo huérfano.
ALTER TABLE tenants
  ADD COLUMN suspended_at     TIMESTAMPTZ NULL,
  ADD COLUMN suspended_by     UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN suspended_reason VARCHAR(300) NULL,
  ADD CONSTRAINT tenants_suspended_coherent
    CHECK ((suspended_at IS NULL) = (suspended_reason IS NULL));

CREATE INDEX tenants_suspended_at_idx ON tenants (suspended_at)
  WHERE suspended_at IS NOT NULL;

-- 2. `purge_tenant(uuid)`: la ÚNICA definición de «borrar un negocio».
--
-- La llaman el API (DELETE /admin/tenants/:id, tras sus candados) y el guion
-- de limpieza masiva `infrastructure/scripts/purge-tenants.sql`. Mismo
-- mecanismo que el teardown de los e2e: con `session_replication_role =
-- replica` los triggers de FK callan y no hace falta conocer el orden de las
-- 47 tablas con `tenant_id`; después se limpian las dos que cuelgan por otra
-- vía (`user_roles`, `role_permissions`) y por último la fila de `tenants`.
--
-- SECURITY DEFINER a propósito: `session_replication_role` es de
-- superusuario y el rol de la app (`sellpoint_app`, sujeto a RLS) no debe
-- tenerlo. La función queda con el dueño que corre las migraciones
-- (`DATABASE_URL_ADMIN`: el superusuario del contenedor en local, CI y
-- producción). Si algún día las migraciones corren con un rol menor, la
-- función falla al primer uso con un error claro, no en silencio.
--
-- Cinturones que viven en la BASE, no solo en el service: el negocio tiene que
-- existir y estar desactivado. Un `DELETE` sobre uno activo no existe.
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

REVOKE EXECUTE ON FUNCTION public.purge_tenant(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purge_tenant(uuid) TO sellpoint_app;
COMMENT ON FUNCTION public.purge_tenant(uuid) IS
  'Borra un negocio DESACTIVADO con todo lo suyo (F7-LIFECYCLE-02). Única definición de «eliminar un negocio»: la usan el API y infrastructure/scripts/purge-tenants.sql. SECURITY DEFINER porque session_replication_role es de superusuario. Exige suspended_at NOT NULL.';
