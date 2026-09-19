// La matriz mercado → idioma → moneda → precios (SITIO-WEB-CONTENIDO.md §6).
// Es documento Y configuración: de aquí salen las rutas del sitio.
//
// Agregar un mercado es agregar una fila a MARKETS y sus idiomas a LOCALES.
// Agregar un idioma es, además, un archivo nuevo en `src/i18n/locales/`.

export const LANGUAGES = ["es", "en", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];

/**
 * Lo que es del PAÍS y no del idioma. `showPrices` vive aquí a propósito:
 * prender Canadá prende `/en-ca/` y `/fr-ca/` a la vez, y así no hay forma de
 * dejar un mercado con el precio en un idioma y sin él en el otro.
 */
export const MARKETS = {
  mx: { country: "MX", currency: "MXN", showPrices: false },
  us: { country: "US", currency: "USD", showPrices: false },
  ca: { country: "CA", currency: "CAD", showPrices: false },
} as const satisfies Record<string, { country: string; currency: string; showPrices: boolean }>;

export type MarketId = keyof typeof MARKETS;

export interface Locale {
  /** El segmento de la URL: `/es-mx/`. */
  route: string;
  market: MarketId;
  language: Language;
  /** El valor de `<html lang>` y de `hreflang` (BCP 47). */
  htmlLang: string;
  /** El idioma que se ofrece primero a quien llega de ese país. */
  isMarketDefault: boolean;
}

export const LOCALES = [
  { route: "es-mx", market: "mx", language: "es", htmlLang: "es-MX", isMarketDefault: true },
  { route: "en-us", market: "us", language: "en", htmlLang: "en-US", isMarketDefault: true },
  { route: "es-us", market: "us", language: "es", htmlLang: "es-US", isMarketDefault: false },
  { route: "en-ca", market: "ca", language: "en", htmlLang: "en-CA", isMarketDefault: true },
  { route: "fr-ca", market: "ca", language: "fr", htmlLang: "fr-CA", isMarketDefault: false },
] as const satisfies readonly Locale[];

export type Route = (typeof LOCALES)[number]["route"];

export const ROUTES: readonly Route[] = LOCALES.map((locale) => locale.route);

/**
 * La versión de quien llega sin país detectado, la que sirve `/` y el
 * `x-default` de hreflang. Carlos, 2026-09-18: «si el sistema no adivina tu
 * país que muestre México, donde estarán la mayoría de clientes».
 */
export const DEFAULT_ROUTE: Route = "es-mx";

export function getLocale(route: Route): Locale {
  const locale = LOCALES.find((candidate) => candidate.route === route);
  // Truena a propósito: caer en silencio a otra versión es enseñarle a
  // alguien los textos —y, el día que se prendan, los precios— de otro país.
  if (!locale)
    throw new Error(`Ruta desconocida: «${route}». Las válidas son ${ROUTES.join(", ")}.`);
  return locale;
}

export function localesOf(market: MarketId): Locale[] {
  return LOCALES.filter((locale) => locale.market === market);
}

export function showPrices(route: Route): boolean {
  return MARKETS[getLocale(route).market].showPrices;
}

/**
 * El dinero lo escribe `Intl`, nunca una plantilla: el francés de Canadá pone
 * el signo al final y separa los miles con espacio (`1 250,50 $`).
 */
export function formatMoney(amount: number, route: Route): string {
  const locale = getLocale(route);
  return new Intl.NumberFormat(locale.htmlLang, {
    style: "currency",
    currency: MARKETS[locale.market].currency,
    // «$» y no «MX$», «US$» o «CA$»: cada versión habla de SU moneda, y la
    // leyenda «Precios para México» (PLANS-04) es la que dice cuál es.
    currencyDisplay: "narrowSymbol",
  }).format(amount);
}
