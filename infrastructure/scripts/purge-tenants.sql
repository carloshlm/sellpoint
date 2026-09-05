-- purge-tenants.sql — borra de la base TODOS los negocios salvo los de la lista
-- KEEP, con todo lo suyo: usuarios, roles, catálogos, almacenes, existencias,
-- ventas, cotizaciones, turnos, expedientes, pagos, auditoría… (las 47 tablas
-- con `tenant_id`, más `user_roles` y `role_permissions`, que cuelgan por
-- CASCADE de usuarios y roles).
--
-- Nació el 2026-09-04 para limpiar los negocios de prueba de producción
-- (Carlos: solo se usan «Negocio Cinco», «BACKOFFICE» y «Siete SA de CV»).
-- Es el mismo mecanismo del teardown de los e2e (`apps/api/test/e2e/
-- global-teardown.ts`): con `session_replication_role = replica` los triggers
-- de FK callan y no hace falta conocer el orden de las tablas; todo va en UNA
-- transacción, o se borra todo o nada.
--
-- CINTURONES:
--  1. RESPALDO antes: /opt/sellpoint/scripts/backup-postgres.sh (el nocturno,
--     a mano). Sin respaldo no se corre. Punto.
--  2. La lista KEEP se pasa por nombre EXACTO y el guion aborta si algún nombre
--     no existe o si existe más de una vez (en producción hay dos «Negocio
--     CUATRO»: por eso se conserva por nombre y se borra por exclusión, nunca
--     al revés).
--  3. Primero en modo `ensayo`: lista lo que se borraría, con usuarios y
--     ventas de cada uno, y NO toca nada. Solo `modo=borrar` borra.
--  4. Requiere superusuario (por el `replica`): con un rol menor falla ANTES
--     de tocar nada, con un error claro.
--
-- USO (en el servidor, como admin de la base):
--
--   ENSAYO:
--   docker exec -i sellpoint-postgres psql -U sellpoint -d sellpoint_prod \
--     -v ON_ERROR_STOP=1 -v modo=ensayo \
--     -v keep='Negocio Cinco|BACKOFFICE|Siete SA de CV' < purge-tenants.sql
--
--   BORRAR (mismo comando, modo=borrar). Revisa el NOTICE final: dice qué
--   quedó.
--
-- Después: `docker exec sellpoint-redis redis-cli --scan --pattern
-- 'entitlements:*' | xargs -r docker exec -i sellpoint-redis redis-cli DEL`
-- es opcional (las claves de negocios borrados expiran solas).

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE purge_keep (name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO purge_keep
SELECT btrim(n) FROM unnest(string_to_array(:'keep', '|')) AS n WHERE btrim(n) <> '';

-- El modo viaja como GUC local a la transacción: dentro del DO no hay
-- interpolación de variables de psql.
SELECT set_config('purge.modo', :'modo', true);

SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  tabla text;
  ids uuid[];
  fila record;
  pedidos int;
  encontrados int;
  modo text := coalesce(current_setting('purge.modo', true), 'ensayo');
BEGIN
  IF modo NOT IN ('ensayo', 'borrar') THEN
    RAISE EXCEPTION 'modo debe ser ensayo o borrar (llegó: %)', modo;
  END IF;

  SELECT count(*) INTO pedidos FROM purge_keep;
  IF pedidos = 0 THEN
    RAISE EXCEPTION 'La lista KEEP está vacía: eso borraría TODOS los negocios. No se hace.';
  END IF;

  -- Cinturón 2: cada nombre de KEEP existe exactamente una vez.
  SELECT count(*) INTO encontrados
  FROM purge_keep k WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.name = k.name);
  IF encontrados <> pedidos THEN
    RAISE EXCEPTION 'KEEP no coincide con la base: % de % nombres encontrados (%). No se borra nada.',
      encontrados, pedidos,
      (SELECT string_agg(k.name, ', ') FROM purge_keep k
        WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.name = k.name));
  END IF;
  IF EXISTS (
    SELECT 1 FROM tenants t JOIN purge_keep k ON k.name = t.name
    GROUP BY t.name HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Un nombre de KEEP está repetido en la base; no se puede decidir por nombre.';
  END IF;

  SELECT array_agg(id) INTO ids
  FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM purge_keep k WHERE k.name = t.name);
  IF ids IS NULL THEN
    RAISE NOTICE 'Nada que borrar: todos los negocios están en KEEP.';
    RETURN;
  END IF;

  FOR fila IN
    SELECT t.name, t.id, t.created_at::date AS alta,
      (SELECT count(*) FROM users u WHERE u.tenant_id = t.id) AS usuarios,
      (SELECT count(*) FROM sales s WHERE s.tenant_id = t.id) AS ventas
    FROM tenants t WHERE t.id = ANY(ids) ORDER BY t.created_at
  LOOP
    RAISE NOTICE '  se borra: % (%, alta %) — % usuario(s), % venta(s)',
      fila.name, fila.id, fila.alta, fila.usuarios, fila.ventas;
  END LOOP;

  IF modo = 'ensayo' THEN
    RAISE NOTICE 'ENSAYO: % negocio(s) se borrarían. No se tocó nada. Quedarían: %',
      array_length(ids, 1), (SELECT string_agg(k.name, ', ') FROM purge_keep k);
    RETURN;
  END IF;

  FOR tabla IN
    SELECT DISTINCT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    -- Solo tablas BASE: una VISTA con tenant_id (medical_clinic_sold_items)
    -- también sale acá y un DELETE sobre ella abortaría el bloque entero.
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
      AND c.table_name <> 'tenants' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE tenant_id = ANY($1)', tabla) USING ids;
  END LOOP;
  -- Las que no llevan tenant_id y cuelgan de usuarios o roles ya borrados
  -- (con `replica` el CASCADE no corre).
  DELETE FROM user_roles WHERE user_id NOT IN (SELECT id FROM users);
  DELETE FROM role_permissions WHERE role_id NOT IN (SELECT id FROM roles);
  DELETE FROM tenants WHERE id = ANY(ids);

  RAISE NOTICE 'BORRADOS % negocio(s). Quedan en la base: %',
    array_length(ids, 1), (SELECT string_agg(name, ', ' ORDER BY created_at) FROM tenants);
END $$;

COMMIT;
