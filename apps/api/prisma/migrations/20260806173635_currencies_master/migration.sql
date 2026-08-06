-- CreateTable
CREATE TABLE "currencies" (
    "code" CHAR(3) NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "name_es" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- Datos de REFERENCIA en la migración (no en el seed demo): llegan a todos
-- los entornos por el pipeline. Idempotente por ON CONFLICT.
INSERT INTO "currencies" ("code", "symbol", "decimals", "name_es", "name_en", "is_active") VALUES
  ('MXN', '$', 2, 'Peso mexicano', 'Mexican peso', true),
  ('USD', '$', 2, 'Dólar estadounidense', 'US dollar', true)
ON CONFLICT ("code") DO NOTHING;

-- Tabla maestra: la app solo LEE. El grant de escritura vino por
-- ALTER DEFAULT PRIVILEGES — se revoca explícito.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sellpoint_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON "currencies" FROM sellpoint_app;
  END IF;
END
$$;
