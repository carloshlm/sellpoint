-- F1-NAME-05 — el apellido deja de tener género.
--
-- `last_name_paternal` / `last_name_maternal` es el modelo MEXICANO, y estaba
-- aplicado a los 26 países: para un negocio de Toronto, «apellido paterno» es
-- simplemente «el apellido». Los nombres nuevos son universales — `last_name`
-- es EL apellido (o el primero, donde hay dos) y `second_last_name` el segundo,
-- que solo existe donde el país lo usa.
--
-- ── Por qué es seguro ───────────────────────────────────────────────────
-- Ningún índice, UNIQUE, DEFAULT, vista ni policy de RLS referencia estas
-- cuatro columnas (verificado contra `20260806170534_user_model` y
-- `20260902210000_f9_recep_customers`). `RENAME COLUMN` en Postgres solo toca
-- el catálogo: no reescribe una sola fila y no toma un lock largo.
--
-- ── Por qué está escrita a MANO ─────────────────────────────────────────
-- `prisma migrate dev` no sabe que un rename es un rename: para él una columna
-- desapareció y otra nació, así que emite `DROP COLUMN` + `ADD COLUMN`. Eso
-- BORRA el nombre de cada persona de la base. Si algún día hay que regenerar
-- esta migración, se crea con `--create-only` y se reemplaza el SQL.
-- `name-rename.integration.spec.ts` monta guardia sobre eso.
--
-- ── La migración `20260906100000_f9_clinic_turn_customer_name_backfill` ──
-- Conserva los nombres VIEJOS dentro de su `concat_ws(...)`, y así se queda:
-- es historia ya aplicada, no se reescribe. Solo el código nuevo usa los
-- nombres nuevos.
--
-- ── Para deshacer ───────────────────────────────────────────────────────
-- Estas cuatro líneas, en este orden:
--   ALTER TABLE "users" RENAME COLUMN "last_name" TO "last_name_paternal";
--   ALTER TABLE "users" RENAME COLUMN "second_last_name" TO "last_name_maternal";
--   ALTER TABLE "customers" RENAME COLUMN "last_name" TO "last_name_paternal";
--   ALTER TABLE "customers" RENAME COLUMN "second_last_name" TO "last_name_maternal";

ALTER TABLE "users" RENAME COLUMN "last_name_paternal" TO "last_name";
ALTER TABLE "users" RENAME COLUMN "last_name_maternal" TO "second_last_name";
ALTER TABLE "customers" RENAME COLUMN "last_name_paternal" TO "last_name";
ALTER TABLE "customers" RENAME COLUMN "last_name_maternal" TO "second_last_name";
