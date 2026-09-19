// F11-SITE-GEO-01 — qué versión del sitio SUGERIRLE a quien llega.
//
// Función pura: recibe lo que el navegador dice de sí mismo (zona horaria e
// idiomas) y devuelve una ruta de la matriz. No lee el navegador ni decide
// nada de la página: eso lo hace el guion del aviso (GEO-02). La tabla de
// casos vive en `test/suggest-market.test.ts`.
//
// SUGERIR, nunca imponer: el resultado solo alimenta un aviso que se puede
// cerrar. Redirigir por esto rompería a quien viaja, a quien usa VPN y al
// robot de Google, que rastrea desde Estados Unidos.
import {
  DEFAULT_ROUTE,
  getLocale,
  type Language,
  type MarketId,
  type MarketLocale,
  type Route,
} from "../config/markets";
import { isNeutralTimeZone, marketOfTimeZone } from "./zones";

export interface BrowserHints {
  /** `Intl.DateTimeFormat().resolvedOptions().timeZone`. */
  timeZone?: string | undefined;
  /** `navigator.languages`, en el orden de preferencia de la persona. */
  languages: readonly string[];
}

interface Tag {
  language: string;
  region: string | undefined;
}

/** `es-US` → `{ language: "es", region: "US" }`. Tolera mayúsculas y basura. */
function parseTag(tag: string): Tag | null {
  const [language, ...rest] = tag.trim().toLowerCase().split(/[-_]/);
  if (!language) return null;
  // La región son dos letras (`mx`) o tres dígitos (`419`, «América Latina»).
  const region = rest.find((part) => /^([a-z]{2}|\d{3})$/.test(part));
  return { language, region: region?.toUpperCase() };
}

/** El primero de `candidates` que aparece en las preferencias de la persona. */
function firstPreferred(tags: Tag[], candidates: Language[]): Language | undefined {
  return tags.find((tag) => (candidates as string[]).includes(tag.language))?.language as
    | Language
    | undefined;
}

const REGION_MARKETS: Record<string, MarketId> = { MX: "mx", US: "us", CA: "ca" };

function routeFor(market: MarketId, tags: Tag[], timeZone: string | undefined): Route {
  switch (market) {
    case "mx":
      // México solo tiene español: la zona basta.
      return "es-mx";
    case "us":
      return firstPreferred(tags, ["en", "es"]) === "es" ? "es-us" : "en-us";
    case "ca":
      // `America/Montreal` es un alias viejo que ya casi ningún sistema reporta
      // (Montreal comparte `America/Toronto`), pero quien lo trae está en Quebec.
      return timeZone === "America/Montreal" || firstPreferred(tags, ["en", "fr"]) === "fr"
        ? "fr-ca"
        : "en-ca";
  }
}

export function suggestMarket({ timeZone, languages }: BrowserHints): MarketLocale {
  const tags = languages.map(parseTag).filter((tag): tag is Tag => tag !== null);

  // 1. La zona horaria, si es de uno de los tres mercados.
  const byZone = marketOfTimeZone(timeZone);
  if (byZone) return getLocale(routeFor(byZone, tags, timeZone));

  // 2. Sin una zona que diga algo, el país que traiga el idioma (`en-CA`).
  //    Con una zona de OTRO país no se busca: quien está en Madrid con el
  //    navegador en `en-US` está en Madrid.
  if (isNeutralTimeZone(timeZone)) {
    const region = tags.find((tag) => tag.region && REGION_MARKETS[tag.region])?.region;
    const byRegion = region ? REGION_MARKETS[region] : undefined;
    if (byRegion) return getLocale(routeFor(byRegion, tags, timeZone));
  }

  // 3. Otro país: decide el idioma PRINCIPAL del navegador. En español, la
  //    versión mexicana; en cualquier otro, la de Estados Unidos en inglés.
  const primary = tags[0]?.language;
  if (primary === undefined) return getLocale(DEFAULT_ROUTE);
  return getLocale(primary === "es" ? "es-mx" : "en-us");
}
