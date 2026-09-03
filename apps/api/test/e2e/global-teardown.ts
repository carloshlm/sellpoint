import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * F0-DB-05 — borra los negocios que ESTA corrida creó.
 *
 * Las pruebas registran negocios reales por el flujo público (a propósito:
 * sin fixtures que se salten la lógica), ~1 000 por corrida. Sin limpieza la
 * base de pruebas crece hasta que las propias pruebas fallan por su tamaño
 * (pasó en `sellpoint_dev` el 2026-09-02, con 46 372 negocios).
 *
 * Cómo:
 *  - Solo los creados desde `E2E_RUN_STARTED_AT` (lo pone `global-setup`):
 *    lo que había antes se respeta.
 *  - Con `session_replication_role = replica` los triggers de FK callan y no
 *    hace falta conocer el orden de las 44 tablas con `tenant_id`; después se
 *    limpian las dos que cuelgan por otra vía (`user_roles`,
 *    `role_permissions`). Todo en UNA transacción: o se borra todo o nada.
 *  - `E2E_KEEP_DATA=1` lo apaga, para mirar la base tras un fallo.
 *  - Jamás toca una base cuyo nombre no contenga «test»: es un DELETE masivo
 *    con las FK apagadas, y el cinturón va antes que la comodidad.
 *
 * Va por `prisma db execute` y no por el cliente generado: este archivo corre
 * en el proceso PADRE de Jest, sin el `moduleNameMapper` de los workers, y
 * ahí el cliente no resuelve sus imports. El CLI es lo único que el proyecto
 * ya tiene a mano (ni `psql` ni `pg` en el host), igual que en
 * `scripts/ensure-test-db.mjs`.
 *
 * Corre una vez al final de TODA la suite (no por spec): una corrida
 * abortada a mitad no deja nada bloqueado, solo negocios que la siguiente no
 * borrará (son de otra hora de inicio) — se van exportando
 * `E2E_RUN_STARTED_AT` a mano o recreando la base.
 */
const DEFAULT_URL = "postgresql://sellpoint:sellpoint@localhost:5432/sellpoint_test";

export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DATA === "1") {
    console.log("teardown: E2E_KEEP_DATA=1, los negocios de la corrida se quedan.");
    return;
  }
  const url = process.env.DATABASE_URL_ADMIN ?? DEFAULT_URL;
  const database = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(database)) {
    console.warn(`teardown: "${database}" no es una base de pruebas; no se borra nada.`);
    return;
  }
  const desde = process.env.E2E_RUN_STARTED_AT;
  if (!desde || Number.isNaN(Date.parse(desde))) {
    console.warn("teardown: sin E2E_RUN_STARTED_AT válido; no se borra nada.");
    return;
  }

  // El instante va como literal ya validado arriba: no hay entrada de usuario.
  const sql = `
BEGIN;
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  tabla text;
  ids uuid[];
BEGIN
  SELECT array_agg(id) INTO ids FROM tenants WHERE created_at >= '${desde}'::timestamptz;
  IF ids IS NULL THEN
    RAISE NOTICE 'teardown: la corrida no dejó negocios nuevos.';
    RETURN;
  END IF;
  FOR tabla IN
    SELECT DISTINCT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'tenants'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE tenant_id = ANY($1)', tabla) USING ids;
  END LOOP;
  -- Las que no llevan tenant_id y cuelgan de usuarios o roles ya borrados.
  DELETE FROM user_roles WHERE user_id NOT IN (SELECT id FROM users);
  DELETE FROM role_permissions WHERE role_id NOT IN (SELECT id FROM roles);
  DELETE FROM tenants WHERE id = ANY(ids);
  RAISE NOTICE 'teardown: % negocio(s) de la corrida borrados.', array_length(ids, 1);
END $$;
COMMIT;
`;
  const apiDir = resolve(__dirname, "..", "..");
  const res = spawnSync("pnpm", ["exec", "prisma", "db", "execute", "--stdin"], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL_ADMIN: url },
    input: sql,
    encoding: "utf8",
  });
  if (res.status !== 0) {
    console.error("teardown: falló la limpieza.", res.stdout, res.stderr);
    return;
  }
  console.log(`teardown: limpieza de "${database}" hecha (negocios desde ${desde}).`);
}
