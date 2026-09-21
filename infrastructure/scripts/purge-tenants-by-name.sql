-- purge-tenants-by-name.sql — borra de la base los negocios que se NOMBRAN,
-- con todo lo suyo: usuarios, roles, catálogos, sucursales, existencias,
-- ventas, cotizaciones, turnos, expedientes, pagos, sesiones, auditoría…
--
-- Hermano de `purge-tenants.sql`, al revés: aquel conserva una lista KEEP y
-- borra TODO lo demás (sirve para vaciar de golpe); este borra EXACTAMENTE los
-- que se listan y no toca nada más. Cuando son dos o tres negocios concretos,
-- nombrar lo que se va es más seguro que nombrar lo que se queda: un olvido en
-- KEEP borra un negocio vivo, un olvido acá simplemente no lo borra.
--
-- El borrado en sí NO vive acá: lo hace `purge_tenant(uuid)` de la base
-- (migración `20260909100000_f7_tenant_lifecycle`), la ÚNICA definición de
-- «eliminar un negocio», la misma que usa el backoffice. Este guion solo elige
-- a quién, lo desactiva si hacía falta (la función exige `suspended_at`) y la
-- llama uno por uno. Todo va en UNA transacción: o se borran todos o ninguno.
--
-- CINTURONES:
--  1. RESPALDO antes: /opt/sellpoint/scripts/backup-postgres.sh. Sin respaldo
--     no se corre. Punto.
--  2. Cada nombre se pasa EXACTO y tiene que existir UNA sola vez: si falta o
--     está repetido (en producción hubo dos «Negocio CUATRO»), aborta sin
--     tocar nada y dice cuál.
--  3. No puede vaciar la base: si la lista cubre TODOS los negocios, aborta.
--  4. Primero en modo `ensayo`: lista lo que se borraría, con usuarios y
--     ventas de cada uno, y NO toca nada. Solo `modo=borrar` borra.
--  5. RETENCIÓN LEGAL (F7-LIFECYCLE-10): un CLIENTE —al menos un pago real
--     registrado— no se borra antes de su plazo (México 10 años, Canadá y
--     Estados Unidos 7, desde que se desactivó). El ensayo lo dice con nombre
--     y fecha, y aborta. Si el pago era de prueba, se ANULA en el backoffice
--     (queda el rastro) y el negocio vuelve a ser borrable.
--  6. Requiere el rol admin de la base (dueño de `purge_tenant`); con un rol
--     menor falla ANTES de tocar nada, con un error claro.
--
-- USO (en el servidor, como admin de la base):
--
--   ENSAYO:
--   docker exec -i sellpoint-postgres psql -U sellpoint -d sellpoint_prod \
--     -v ON_ERROR_STOP=1 -v modo=ensayo \
--     -v borrar='Siete SA de CV|Canada Uno|DOS SA de CV' < purge-tenants-by-name.sql
--
--   BORRAR (mismo comando, modo=borrar). Revisa el NOTICE final: dice qué quedó.
--
-- Después, en Redis, las claves derivadas del negocio (`entitlements:<id>`,
-- `perm-epoch:<id>`): caducan solas, borrarlas es opcional y solo acelera.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE purge_pedidos (name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO purge_pedidos
SELECT btrim(n) FROM unnest(string_to_array(:'borrar', '|')) AS n WHERE btrim(n) <> '';

-- El modo viaja como GUC local a la transacción: dentro del DO no hay
-- interpolación de variables de psql.
SELECT set_config('purge.modo', :'modo', true);

DO $$
DECLARE
  ids uuid[];
  id_negocio uuid;
  resumen jsonb;
  fila record;
  pedidos int;
  encontrados int;
  total_negocios int;
  clientes int := 0;
  modo text := coalesce(current_setting('purge.modo', true), 'ensayo');
BEGIN
  IF modo NOT IN ('ensayo', 'borrar') THEN
    RAISE EXCEPTION 'modo debe ser ensayo o borrar (llegó: %)', modo;
  END IF;

  SELECT count(*) INTO pedidos FROM purge_pedidos;
  IF pedidos = 0 THEN
    RAISE EXCEPTION 'La lista de negocios a borrar está vacía. No se hace nada.';
  END IF;

  -- Cinturón 2a: cada nombre pedido existe en la base.
  SELECT count(*) INTO encontrados
  FROM purge_pedidos p WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.name = p.name);
  IF encontrados <> pedidos THEN
    RAISE EXCEPTION 'Un nombre pedido no existe en la base: % de % encontrados (falta: %). No se borra nada.',
      encontrados, pedidos,
      (SELECT string_agg(p.name, ', ') FROM purge_pedidos p
        WHERE NOT EXISTS (SELECT 1 FROM tenants t WHERE t.name = p.name));
  END IF;

  -- Cinturón 2b: y existe UNA sola vez. Con dos homónimos no hay forma de
  -- saber cuál quiere irse: se resuelve a mano, por id.
  IF EXISTS (
    SELECT 1 FROM tenants t JOIN purge_pedidos p ON p.name = t.name
    GROUP BY t.name HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Un nombre pedido está repetido en la base (%): no se puede decidir por nombre, hay que borrar por id.',
      (SELECT string_agg(DISTINCT t.name, ', ') FROM tenants t JOIN purge_pedidos p ON p.name = t.name
        WHERE (SELECT count(*) FROM tenants t2 WHERE t2.name = t.name) > 1);
  END IF;

  SELECT array_agg(t.id) INTO ids
  FROM tenants t WHERE EXISTS (SELECT 1 FROM purge_pedidos p WHERE p.name = t.name);

  -- Cinturón 3: esto borra los que se nombran, no la base entera.
  SELECT count(*) INTO total_negocios FROM tenants;
  IF array_length(ids, 1) >= total_negocios THEN
    RAISE EXCEPTION 'La lista cubre TODOS los negocios de la base (%). Eso no es una limpieza: no se hace.',
      total_negocios;
  END IF;


  -- Cinturón de retención (F7-LIFECYCLE-10): un CLIENTE —al menos un pago
  -- real— se conserva lo que pide la ley de su país (MX 10 años, CA y US 7)
  -- desde que se desactivó. `purge_tenant()` se negaría de todos modos; aquí
  -- se dice ANTES, en el ensayo, y con todos los nombres de una vez.
  FOR fila IN
    SELECT t.name, tenant_retention_years(t.id) AS anios, t.suspended_at
    FROM tenants t
    WHERE t.id = ANY(ids) AND tenant_retention_years(t.id) IS NOT NULL
      AND (t.suspended_at IS NULL
        OR t.suspended_at + make_interval(years => tenant_retention_years(t.id)) > now())
    ORDER BY t.created_at
  LOOP
    clientes := clientes + 1;
    RAISE NOTICE '  NO SE PUEDE: % es CLIENTE (tiene pagos reales): retención legal de % años, %',
      fila.name, fila.anios,
      CASE WHEN fila.suspended_at IS NULL
        THEN 'y ni siquiera está desactivado: el plazo no ha empezado a correr'
        ELSE 'hasta el ' || to_char(fila.suspended_at + make_interval(years => fila.anios), 'YYYY-MM-DD')
      END;
  END LOOP;
  IF clientes > 0 THEN
    RAISE EXCEPTION '% negocio(s) de la lista son CLIENTES bajo retención legal. No se borra nada. Si el pago era de prueba, anúlalo desde el backoffice y vuelve a correr el ensayo.',
      clientes;
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
      array_length(ids, 1),
      (SELECT string_agg(t.name, ', ' ORDER BY t.created_at) FROM tenants t WHERE NOT (t.id = ANY(ids)));
    RETURN;
  END IF;

  FOREACH id_negocio IN ARRAY ids LOOP
    -- La función exige un negocio DESACTIVADO: se marca con el motivo del guion.
    UPDATE tenants SET suspended_at = now(), suspended_reason = 'purge-tenants-by-name.sql'
      WHERE id = id_negocio AND suspended_at IS NULL;
    resumen := purge_tenant(id_negocio);
    RAISE NOTICE '  borrado: % — % usuario(s), % venta(s), % tablas',
      resumen->>'name', resumen->>'users', resumen->>'sales', resumen->>'tables';
  END LOOP;

  RAISE NOTICE 'BORRADOS % negocio(s). Quedan en la base: %',
    array_length(ids, 1), (SELECT string_agg(name, ', ' ORDER BY created_at) FROM tenants);
END $$;

COMMIT;
