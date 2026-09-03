#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * F0-DB-04 — garantiza que exista la base de PRUEBAS y que esté migrada.
 *
 * Las pruebas registran negocios reales por el flujo público —a propósito—
 * y llegaron a dejar 46 372 negocios en `sellpoint_dev`, la base del servidor
 * de desarrollo: el backoffice rebasó los 65 535 parámetros de Postgres y dos
 * e2e fallaban por la base, no por el código (2026-09-02). La cura es que las
 * pruebas tengan SU base: `sellpoint_test`.
 *
 * Idempotente y barato: si la base ya existe no hace nada más que aplicar las
 * migraciones pendientes (segundos). Corre antes de `pnpm test` y de
 * `pnpm test:e2e` desde `package.json`, así que nadie tiene que acordarse.
 *
 * Se apoya en `prisma db execute` y `prisma migrate deploy` porque son lo
 * único que el proyecto ya tiene a mano: no hay `psql` ni `pg` en el host.
 */
const DEFAULT_URL = "postgresql://sellpoint:sellpoint@localhost:5432/sellpoint_test";
const url = new URL(process.env.DATABASE_URL_ADMIN ?? DEFAULT_URL);
const database = url.pathname.replace(/^\//, "");

// Cinturón: este script crea y migra, y el teardown BORRA. Ninguno de los
// dos debe tocar jamás una base que no sea de pruebas.
if (!/test/i.test(database)) {
  console.error(
    `ensure-test-db: la base "${database}" no parece de pruebas (no contiene "test"). ` +
      "Apunta DATABASE_URL_ADMIN a sellpoint_test o déjalo sin definir.",
  );
  process.exit(1);
}

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prisma = (args, env, input) =>
  spawnSync("pnpm", ["exec", "prisma", ...args], {
    cwd: apiDir,
    env: { ...process.env, ...env },
    input,
    encoding: "utf8",
  });

// ── Crear la base si no existe ─────────────────────────────────────────
// `CREATE DATABASE` no admite IF NOT EXISTS: se intenta y se acepta el
// «ya existe» (42P04) como éxito. Se conecta a la base de mantenimiento
// `postgres`, que siempre está.
const maintenance = new URL(url);
maintenance.pathname = "/postgres";
const creada = prisma(
  ["db", "execute", "--stdin"],
  { DATABASE_URL_ADMIN: maintenance.toString() },
  `CREATE DATABASE "${database}";\n`,
);
const salida = `${creada.stdout}\n${creada.stderr}`;
if (creada.status !== 0 && !/already exists|42P04/.test(salida)) {
  console.error(salida);
  process.exit(creada.status ?? 1);
}
console.log(
  /already exists|42P04/.test(salida)
    ? `ensure-test-db: "${database}" ya existía.`
    : `ensure-test-db: "${database}" creada.`,
);

// ── Migrarla ───────────────────────────────────────────────────────────
// Las migraciones crean el rol `sellpoint_app` y las policies de RLS, así
// que la base de pruebas queda idéntica a la de desarrollo.
const migrada = prisma(["migrate", "deploy"], { DATABASE_URL_ADMIN: url.toString() });
if (migrada.status !== 0) {
  console.error(migrada.stdout, migrada.stderr);
  process.exit(migrada.status ?? 1);
}
const resumen = migrada.stdout.match(/No pending migrations|(\d+) migrations? applied/)?.[0];
console.log(`ensure-test-db: "${database}" migrada${resumen ? ` (${resumen})` : ""}.`);
