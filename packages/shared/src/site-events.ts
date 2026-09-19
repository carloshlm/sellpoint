import { z } from "zod";
import { SITE_LANGUAGES, SITE_MARKETS, SITE_PLAN_INTERESTS, type SiteMarket } from "./site-leads";

/**
 * F11-SITE-SEO-06 — la medición del sitio público, en el API propio.
 *
 * Lo que NO se guarda es la mitad del diseño: sin `tenant_id`, sin IP, sin
 * agente de usuario y sin identificador de visitante. Desde `site_events` no
 * se puede reconstruir a una persona, y por eso el sitio no pone cookies ni
 * pide consentimiento. Lo que se cede a sabiendas: no hay «visitantes
 * únicos», solo conteos.
 */

/**
 * Los CINCO eventos, lista cerrada. Un endpoint público que guarda texto
 * libre es un basurero: lo que no está acá se descarta al recibirlo.
 */
export const SITE_EVENT_NAMES = [
  /** Clic en «Empieza gratis» — la conversión principal. */
  "cta_click",
  /** Apertura del formulario, con el plan que lo abrió. */
  "form_open",
  /** Formulario enviado — la conversión secundaria. */
  "form_submit",
  /** Cambio de país o idioma: muchos cambios = la detección falla. */
  "market_change",
  /** «Ver todo lo que incluye»: si las tarjetas resumidas alcanzan. */
  "plans_expand",
] as const;
export type SiteEventName = (typeof SITE_EVENT_NAMES)[number];

/** El nombre de sección del sitio (`hero`, `plans`…), corto y sin datos. */
export const SITE_EVENT_SECTION_MAX = 40;
export const SITE_EVENT_REFERRER_MAX = 120;

/** Texto opcional que llega vacío o nulo y se guarda como NULL. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value));
}

export const siteEventSchema = z.object({
  event: z.enum(SITE_EVENT_NAMES),
  market: z.enum(SITE_MARKETS),
  locale: z.enum(SITE_LANGUAGES),
  section: optionalText(SITE_EVENT_SECTION_MAX),
  plan: z
    .enum(SITE_PLAN_INTERESTS)
    .nullish()
    .transform((value) => value ?? null),
  /**
   * Llega como venga —dominio pelado o URL completa— y el SERVIDOR lo recorta
   * a dominio con `normalizeReferrerDomain`. No se confía en que el sitio ya
   * lo haya hecho: la ruta de un `Referer` puede llevar datos de la persona.
   */
  referrerDomain: optionalText(SITE_EVENT_REFERRER_MAX),
});

export type SiteEventInput = z.infer<typeof siteEventSchema>;

/**
 * De lo que llegue, SOLO el dominio: `google.com`, nunca
 * `google.com/search?q=…`. Lo que no parsea se descarta —guardarlo crudo
 * sería justo la fuga que esta tabla evita.
 */
export function normalizeReferrerDomain(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  // A mano y no con `new URL`: este paquete lo compila el API (Node) y el
  // sitio (navegador) con la misma configuración de `lib`, que no trae URL.
  const host = value
    .trim()
    // El esquema, si lo trae.
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    // Todo lo que va después del dominio: ruta, query y fragmento. Ahí es
    // justo donde un buscador mete lo que la persona escribió.
    .replace(/[/?#].*$/, "")
    // El usuario y la contraseña de una URL con credenciales.
    .replace(/^[^@]*@/, "")
    // El puerto.
    .replace(/:\d+$/, "")
    .toLowerCase();

  // Un hostname sin punto (`localhost`) o con caracteres que no son de un
  // dominio (la basura que queda de un texto con espacios) no es un origen.
  if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) {
    return null;
  }
  // `www.` se quita para no tener dos filas del mismo origen; cualquier otro
  // subdominio se conserva — `l.instagram.com` no es `instagram.com`.
  return host.startsWith("www.") ? host.slice(4) : host;
}

// ── El resumen del backoffice (F11-SITE-LEAD-09) ────────────────────────────

const daySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

export const siteEventsQuerySchema = z.object({
  from: daySchema,
  to: daySchema,
  market: z.enum(SITE_MARKETS).optional(),
});
export type SiteEventsQuery = z.infer<typeof siteEventsQuerySchema>;

/** De dónde llegan los que convierten: dominio → conteo de las dos acciones. */
export interface SiteReferrerCount {
  domain: string;
  formSubmit: number;
  ctaClick: number;
  /** La suma de las dos, que es por la que se ordena el top. */
  total: number;
}

/** Cuántos orígenes trae `topReferrers`, como máximo. */
export const SITE_TOP_REFERRERS = 10;

export interface SiteEventsSummary {
  from: string;
  to: string;
  /** Los cinco eventos SIEMPRE presentes, en cero si no hubo ninguno. */
  byEvent: Record<SiteEventName, number>;
  byMarket: Record<SiteMarket, number>;
  /**
   * De cada 100 que abren el formulario, cuántos lo envían. `null` —y no 0—
   * cuando nadie lo abrió: una tasa sin denominador no es cero, es nada.
   */
  formOpenToSubmitRate: number | null;
  topReferrers: SiteReferrerCount[];
}
