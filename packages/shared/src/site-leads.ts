import { z } from "zod";
import { ISO_COUNTRY_CODES } from "./countries";

/**
 * F11-SITE-LEAD-02/03 — el formulario de interés de `sellpointy.com`.
 *
 * Un prospecto NO es un negocio: no tiene `tenant_id`, no lo alcanza `purge_tenant`
 * y no vive bajo RLS. Este archivo es el contrato entre el sitio (Astro, que
 * valida antes de enviar) y el API (que vuelve a validar al recibir, porque lo
 * que llega de internet no se cree nunca).
 */

/** Los planes de las tarjetas, más «algo a la medida» y «todavía no sé». */
export const SITE_PLAN_INTERESTS = ["basic", "pro", "plus", "custom", "undecided"] as const;
export type SitePlanInterest = (typeof SITE_PLAN_INTERESTS)[number];

/**
 * Los idiomas del SITIO, que no son los de la aplicación: el francés existe en
 * `/fr-ca/` y se anuncia como «bientôt» dentro del producto. Por eso esta lista
 * no es `SUPPORTED_LOCALES` de `i18n.ts` y no debe fusionarse con ella.
 */
export const SITE_LANGUAGES = ["es", "en", "fr"] as const;
export type SiteLanguage = (typeof SITE_LANGUAGES)[number];

/** Los mercados con página propia: una URL por mercado e idioma. */
export const SITE_MARKETS = ["mx", "us", "ca"] as const;
export type SiteMarket = (typeof SITE_MARKETS)[number];

/**
 * Los topes de cada campo, en UN solo lugar: la columna de la base, el
 * `maxlength` del formulario y este schema tienen que decir el mismo número.
 */
export const SITE_LEAD_LIMITS = {
  name: 120,
  /** El máximo de un correo según RFC 5321. */
  email: 254,
  businessType: 80,
  message: 2_000,
  consentText: 600,
  sourceUrl: 500,
  /** `es-mx`: dos letras, guion, dos letras. */
  route: 8,
} as const;

/**
 * F11-SITE-LEAD-03 — el piso de tiempo entre cargar la página y enviar. Una
 * persona no llena nombre, correo y mensaje en menos de tres segundos; un
 * robot sí. Es una constante con nombre porque el sitio la necesita para
 * decidir si todavía tiene que esperar antes de habilitar el botón.
 */
export const SITE_LEAD_MIN_ELAPSED_MS = 3_000;

/** Texto opcional que puede llegar vacío o nulo y se guarda como NULL. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value === undefined || value === null || value === "" ? null : value));
}

export const siteLeadSchema = z.object({
  name: z.string().trim().min(1).max(SITE_LEAD_LIMITS.name),
  // El correo se normaliza a minúsculas ANTES de guardarlo: LEAD-10 compara
  // contra `users.email` en minúsculas para saber si el prospecto ya es
  // cliente, y dos formas del mismo correo romperían esa comparación.
  email: z
    .string()
    .trim()
    .pipe(z.email().max(SITE_LEAD_LIMITS.email))
    .transform((value) => value.toLowerCase()),
  // Cualquier ISO-2 real, no solo los tres mercados: alguien de Argentina
  // puede escribir desde `/es-mx/` y su país es un dato, no un error.
  country: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(ISO_COUNTRY_CODES)),
  locale: z.enum(SITE_LANGUAGES),
  // La ruta se valida por FORMA y no contra la matriz del sitio: prender un
  // mercado nuevo no puede exigir un despliegue del API.
  route: z
    .string()
    .trim()
    .max(SITE_LEAD_LIMITS.route)
    .regex(/^[a-z]{2}-[a-z]{2}$/),
  planInterest: z.enum(SITE_PLAN_INTERESTS),
  businessType: optionalText(SITE_LEAD_LIMITS.businessType),
  message: optionalText(SITE_LEAD_LIMITS.message),
  sourceUrl: optionalText(SITE_LEAD_LIMITS.sourceUrl),
  // El consentimiento es `true` LITERAL, no «algo verdadero»: un `1` o un
  // `"on"` del navegador tienen que romperse acá y no colarse como un sí.
  consent: z.literal(true),
  // Lo que la persona leyó, palabra por palabra. Si mañana cambia el texto,
  // esta columna es la única prueba de qué aceptó quien aceptó ayer.
  consentText: z.string().trim().min(1).max(SITE_LEAD_LIMITS.consentText),

  // ── Los dos campos anti-robot ─────────────────────────────────────────
  // NO se guardan y NO invalidan el cuerpo a propósito (ver `isSiteLeadSpam`).
  // `website` es `unknown` porque un robot puede llenarlo con cualquier cosa
  // y un 400 le diría exactamente qué corregir.
  website: z.unknown().optional(),
  elapsedMs: z.number().int().nonnegative().optional(),
});

export type SiteLeadInput = z.infer<typeof siteLeadSchema>;

/**
 * F11-SITE-LEAD-03 — la decisión de descartar EN SILENCIO, separada del
 * schema para que se pueda probar sola y para que el API responda siempre el
 * mismo 202: lo que se descarta no se guarda, no avisa y no se cuenta.
 *
 * Dos señales, ninguna con captcha:
 *  · la trampa (`website`), un campo que una persona no ve y un robot llena;
 *  · el reloj, que un robot no espera.
 *
 * Sin `elapsedMs` NO se descarta: el reloj lo pone el JavaScript del sitio y
 * tragarse el mensaje de quien no lo ejecuta costaría prospectos reales.
 */
export function isSiteLeadSpam(input: { website?: unknown; elapsedMs?: number }): boolean {
  if (typeof input.website === "string" && input.website.trim() !== "") {
    return true;
  }
  if (input.website !== undefined && input.website !== null && typeof input.website !== "string") {
    return true;
  }
  return input.elapsedMs !== undefined && input.elapsedMs < SITE_LEAD_MIN_ELAPSED_MS;
}

// ── El backoffice (F11-SITE-LEAD-08) ────────────────────────────────────────

/** Día del calendario, `YYYY-MM-DD`: el rango se pide en días, no en instantes. */
const daySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/);

export const SITE_LEADS_PAGE_SIZE_MAX = 200;

export const siteLeadsQuerySchema = z.object({
  from: daySchema.optional(),
  to: daySchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(SITE_LEADS_PAGE_SIZE_MAX).default(20),
});
export type SiteLeadsQuery = z.infer<typeof siteLeadsQuerySchema>;

/** Una fila de la lista de solo lectura del backoffice. */
export interface SiteLeadRow {
  id: string;
  /** ISO-8601, como lo serializa el API. */
  createdAt: string;
  name: string;
  email: string;
  country: string;
  route: string;
  planInterest: SitePlanInterest;
  businessType: string | null;
  message: string | null;
  /** Derivado de `notified_at`: si el aviso a la plataforma salió o no. */
  notified: boolean;
}

export interface SiteLeadsPage {
  items: SiteLeadRow[];
  total: number;
  page: number;
  pageSize: number;
}
