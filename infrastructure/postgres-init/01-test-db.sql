-- F0-DB-04 — la base de PRUEBAS, separada de la del servidor de desarrollo.
--
-- Postgres ejecuta esta carpeta SOLO al crear el volumen por primera vez: un
-- volumen que ya existía no la ve. Para ese caso está
-- `apps/api/scripts/ensure-test-db.mjs`, que corre antes de cada `pnpm test`
-- y crea la base si falta. Aquí es cortesía para la instalación desde cero.
CREATE DATABASE sellpoint_test;
