-- f1-auth U1-05: puerta de login. Tres cambios independientes:
--   1. Email único GLOBAL (D1, decision-email-global #228) — reemplaza el
--      unique compuesto (tenant_id, email) por un índice FUNCIONAL sobre
--      lower(email). Prisma no representa índices funcionales en el schema
--      (mismo motivo que el CHECK de currency/locale) — vive acá a mano.
--   2. tenant_id en las 3 tablas de tokens de un solo uso/refresh — las
--      rutas pre-auth (refresh/verify-email/reset-password) resuelven el
--      tenant desde la fila del token, sin pasar por la función
--      SECURITY DEFINER (AD-3). Patrón seguro nullable→backfill→NOT NULL
--      aunque hoy las tablas estén vacías (no hay usuarios en producción).
--   3. Puerta SECURITY DEFINER: rol sellpoint_auth (BYPASSRLS, SELECT
--      limitado a 2 columnas de users) + función auth_resolve_tenant_by_email
--      — ÚNICA excepción de RLS del sistema, para que login pueda abrir
--      contexto sin conocer el tenant de antemano (AD-2).
--
-- Además, corrige un bug real encontrado por los tests de integración de
-- withTenantContext (f1-auth U1-11): las policies "tenant_isolation"
-- creadas en 20260806171516_enable_rls_tenant_isolation usan
-- `current_setting('app.tenant_id', true)::uuid`. Postgres devuelve '' (NO
-- NULL) para un GUC custom que fue seteado alguna vez en la sesión y volvió
-- a su default tras un `SET LOCAL` — y '' ::uuid revienta con
-- "invalid input syntax for type uuid", en vez de filtrar a 0 filas. Con
-- pooling de conexiones esto envenena cualquier conexión reciclada después
-- del primer login. Fix: NULLIF(..., '') antes del cast, en las 3 policies.

-- ============================================================
-- 1. Email único global
-- ============================================================

-- DropIndex
DROP INDEX "users_tenant_id_email_key";

-- CreateIndex (funcional, sobre lower(email) — la normalización ya la hace
-- el DTO, pero la DB no debe confiar en la app)
CREATE UNIQUE INDEX "users_email_key" ON "users" (lower("email"));

-- ============================================================
-- 2. tenant_id en tablas de tokens (nullable → backfill → NOT NULL)
-- ============================================================

-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "email_verification_tokens" ADD COLUMN "tenant_id" UUID;
ALTER TABLE "password_reset_tokens" ADD COLUMN "tenant_id" UUID;

-- Backfill desde users (tablas vacías hoy, pero el patrón es correcto
-- incluso si dejaran de estarlo)
UPDATE "refresh_tokens" t SET "tenant_id" = u."tenant_id"
  FROM "users" u WHERE u."id" = t."user_id";
UPDATE "email_verification_tokens" t SET "tenant_id" = u."tenant_id"
  FROM "users" u WHERE u."id" = t."user_id";
UPDATE "password_reset_tokens" t SET "tenant_id" = u."tenant_id"
  FROM "users" u WHERE u."id" = t."user_id";

ALTER TABLE "refresh_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "email_verification_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;
ALTER TABLE "password_reset_tokens" ALTER COLUMN "tenant_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens"("tenant_id");
CREATE INDEX "email_verification_tokens_tenant_id_idx" ON "email_verification_tokens"("tenant_id");
CREATE INDEX "password_reset_tokens_tenant_id_idx" ON "password_reset_tokens"("tenant_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- 3. Fix del bug de RLS (NULLIF) — ver comentario de cabecera
-- ============================================================

ALTER POLICY "tenant_isolation" ON "users"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER POLICY "tenant_isolation" ON "roles"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER POLICY "tenant_isolation" ON "audit_logs"
  USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- ============================================================
-- 4. Puerta SECURITY DEFINER (AD-2): rol propio + grant a nivel de COLUMNA
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'sellpoint_auth') THEN
    CREATE ROLE sellpoint_auth NOLOGIN BYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO sellpoint_auth;
-- SOLO estas 2 columnas — jamás password_hash ni el resto de la fila.
GRANT SELECT (tenant_id, email) ON public.users TO sellpoint_auth;

CREATE OR REPLACE FUNCTION public.auth_resolve_tenant_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT tenant_id FROM public.users WHERE email = lower(btrim(p_email)) LIMIT 1 $$;

ALTER FUNCTION public.auth_resolve_tenant_by_email(text) OWNER TO sellpoint_auth;
REVOKE EXECUTE ON FUNCTION public.auth_resolve_tenant_by_email(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.auth_resolve_tenant_by_email(text) TO sellpoint_app;
COMMENT ON FUNCTION public.auth_resolve_tenant_by_email(text) IS
  'ÚNICA excepción de RLS del sistema (f1-auth D1). Devuelve SOLO tenant_id para que login pueda abrir contexto. Owner sellpoint_auth: BYPASSRLS pero con SELECT limitado a (tenant_id,email) de users. Sin SQL dinámico, search_path fijo. NO agregar columnas al RETURNS.';
