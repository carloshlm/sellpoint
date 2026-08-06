-- Usuario de RUNTIME sin privilegios: la API conecta como sellpoint_app
-- (NO superuser, NO owner) para que RLS le aplique de verdad.
-- El superuser sellpoint queda SOLO para migraciones y seed.
-- El password se setea POR ENTORNO fuera del repo (dev: comando docker;
-- prod: comando ssh) — una migracion jamas contiene secretos.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sellpoint_app') THEN
    CREATE ROLE sellpoint_app LOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sellpoint_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sellpoint_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sellpoint_app;

-- Tablas futuras creadas por sellpoint (migraciones) heredan los grants
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sellpoint_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO sellpoint_app;

-- Least privilege: la app no tiene por que ver el estado de migraciones.
-- Condicional porque la shadow database de migrate dev aplica esta migracion
-- antes de que exista _prisma_migrations.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM sellpoint_app;
  END IF;
END
$$;
