-- F11-SITE-LEAD-01 — los prospectos del sitio público (sellpointy.com).
--
-- ⚠️ ESTA TABLA NO LLEVA `tenant_id`, Y ESO ES TODO EL DISEÑO.
--
-- `purge_tenant(uuid)` recorre en caliente `information_schema.columns` y borra
-- de TODA tabla base que tenga una columna llamada `tenant_id`:
--
--   WHERE c.column_name = 'tenant_id' AND c.table_name <> 'tenants'
--
-- Un prospecto TODAVÍA NO ES UN NEGOCIO: nadie lo dio de alta, no pertenece a
-- ningún tenant y eliminar un negocio no puede llevarse por delante la lista de
-- quién nos escribió. Tampoco lleva RLS por la misma razón: no hay un tenant
-- contra el cual aislar, y el único que la lee es el backoffice de la
-- plataforma (`PlatformAdminGuard`), que no abre contexto de tenant.
--
-- El consentimiento se guarda DOBLE a propósito: `consent_at` (cuándo) y
-- `consent_text` (qué decía la casilla, palabra por palabra). Si mañana cambia
-- el texto del aviso, esta columna es la única prueba de qué aceptó quien
-- aceptó ayer — una referencia a «la versión vigente» no lo es.
--
-- `notified_at` NULL significa «está en la base pero el aviso no salió»: se
-- guarda primero y se avisa después, así que un Resend caído nunca pierde un
-- prospecto (F11-SITE-LEAD-04). Es también la columna que mira el backoffice
-- para saber a quién hay que contestarle a mano.
--
-- Retención: 24 meses (F11-SITE-LEAD-10, `SiteLeadsRetentionJob`). El aviso de
-- privacidad lo promete, así que tiene que ser verdad.
CREATE TABLE "site_leads" (
  "id"            uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"          varchar(120)    NOT NULL,
  -- Siempre en minúsculas (lo normaliza el schema de `shared`): la retención
  -- compara este correo contra `users.email` para no borrar a quien ya es
  -- cliente, y dos formas del mismo correo romperían esa comparación.
  "email"         varchar(254)    NOT NULL,
  -- ISO 3166-1 alpha-2. Cualquiera de la lista, no solo los tres mercados:
  -- alguien de Argentina puede escribir desde `/es-mx/`.
  "country"       char(2)         NOT NULL,
  -- El idioma del SITIO, que incluye el francés — que la aplicación todavía
  -- no habla. Por eso el CHECK no es el de `users.locale`.
  "locale"        char(2)         NOT NULL,
  -- El segmento de la URL desde donde escribió: `es-mx`, `fr-ca`.
  "route"         varchar(8)      NOT NULL,
  "plan_interest" varchar(16)     NOT NULL,
  "business_type" varchar(80),
  "message"       varchar(2000),
  "source_url"    varchar(500),
  "consent_at"    timestamptz(6)  NOT NULL,
  "consent_text"  varchar(600)    NOT NULL,
  "notified_at"   timestamptz(6),
  "created_at"    timestamptz(6)  NOT NULL DEFAULT now(),

  CONSTRAINT "site_leads_locale_check"
    CHECK ("locale" IN ('es', 'en', 'fr')),
  CONSTRAINT "site_leads_plan_interest_check"
    CHECK ("plan_interest" IN ('basic', 'pro', 'plus', 'custom', 'undecided'))
);

-- Las dos únicas consultas que existen sobre esta tabla recorren el tiempo: la
-- lista del backoffice (más nuevo primero, por rango de fechas) y el barrido de
-- retención (todo lo anterior a una fecha).
CREATE INDEX "site_leads_created_at_idx" ON "site_leads" ("created_at" DESC);
