-- F7-DB-06: el plano de administración del dueño de la plataforma.
--
-- No existe SuperAdmin (los roles son POR tenant): el backoffice de billing
-- se gatea con este flag EN AND con la whitelist BILLING_ADMIN_EMAILS del
-- env — dos llaves para que ni un UPDATE malicioso ni un email reasignado
-- basten solos. El flag NUNCA viaja en el JWT (un token de 15 minutos
-- conservaría el privilegio tras revocarlo): PlatformAdminGuard consulta por
-- PK, solo en /admin/*.

ALTER TABLE "users" ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT false;
