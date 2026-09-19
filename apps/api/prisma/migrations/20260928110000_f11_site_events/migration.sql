-- F11-SITE-SEO-06 — la medición del sitio público, en el API propio.
--
-- Carlos, 2026-09-18: «sin herramientas de terceros ni contenedores nuevos».
-- No hace falta un producto para contar cinco cosas.
--
-- ⚠️ LO QUE ESTA TABLA NO GUARDA ES LA MITAD DEL DISEÑO.
--
-- Sin `tenant_id` (mismo motivo que `site_leads`: `purge_tenant` barre por
-- nombre de columna), y además SIN IP, SIN agente de usuario y SIN ningún
-- identificador de visitante. Desde aquí no se puede reconstruir a una
-- persona, y por eso el sitio no pone cookies, no pide consentimiento y el
-- aviso de privacidad no tiene nada que declarar.
--
-- Lo que se cede a sabiendas: no hay «visitantes únicos», solo conteos. 100
-- visitas de una persona y 100 personas se ven igual. Para saber si el sitio
-- vende, que es la pregunta, no hace falta distinguirlas.
--
-- `referrer_domain` guarda SOLO el dominio (`google.com`), nunca la URL: la
-- ruta y la query de un `Referer` son justo donde un buscador mete lo que la
-- persona escribió. El recorte lo hace el SERVIDOR
-- (`normalizeReferrerDomain`), no el sitio.
CREATE TABLE "site_events" (
  "id"              uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"      timestamptz(6)  NOT NULL DEFAULT now(),
  "event"           varchar(24)     NOT NULL,
  "market"          char(2)         NOT NULL,
  "locale"          char(2)         NOT NULL,
  "section"         varchar(40),
  "plan"            varchar(16),
  "referrer_domain" varchar(120),

  -- Los CINCO eventos, cerrados también en la base: un endpoint público que
  -- guarda texto libre es un basurero, y el CHECK es la última puerta.
  CONSTRAINT "site_events_event_check"
    CHECK ("event" IN ('cta_click', 'form_open', 'form_submit', 'market_change', 'plans_expand')),
  CONSTRAINT "site_events_market_check"
    CHECK ("market" IN ('mx', 'us', 'ca')),
  CONSTRAINT "site_events_locale_check"
    CHECK ("locale" IN ('es', 'en', 'fr')),
  CONSTRAINT "site_events_plan_check"
    CHECK ("plan" IS NULL OR "plan" IN ('basic', 'pro', 'plus', 'custom', 'undecided'))
);

-- El resumen del backoffice siempre acota por rango; el desglose por evento
-- (las dos tasas que importan) filtra además por `event`.
CREATE INDEX "site_events_created_at_idx" ON "site_events" ("created_at");
CREATE INDEX "site_events_event_created_at_idx" ON "site_events" ("event", "created_at");
