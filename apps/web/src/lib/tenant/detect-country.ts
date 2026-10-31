import { ISO_COUNTRY_CODES } from "@sellpoint/shared";
import { TIMEZONES_BY_COUNTRY } from "./country-timezones";

/**
 * País probable de quien se registra, deducido SOLO de lo que el navegador ya
 * sabe (decisión de Carlos, 2026-10-31): nada sale de la computadora ni se
 * consulta un servicio de geolocalización por IP.
 *
 * 1. La zona horaria del sistema, buscada en `TIMEZONES_BY_COUNTRY` (cada
 *    zona de `zone.tab` es de un solo país). Es la pista más fiel: alguien
 *    en Toronto con el navegador en inglés de EE. UU. sigue en Canadá.
 * 2. Si la zona no dice nada (`Etc/UTC`, una zona desconocida), la región del
 *    primer idioma que la traiga (`es-MX` → MX).
 * 3. Sin pistas, `""`: el wizard no adivina y la persona elige.
 */
export interface DetectedLocation {
  country: string;
  timeZone: string;
}

const ISO_COUNTRIES = new Set<string>(ISO_COUNTRY_CODES);

const COUNTRY_BY_TIMEZONE = new Map(
  Object.entries(TIMEZONES_BY_COUNTRY).flatMap(([country, zones]) =>
    zones.map((zone) => [zone, country] as const),
  ),
);

// Chrome responde con el nombre que CLDR considera canónico, que a veces es
// el viejo (`Asia/Calcutta`), mientras `zone.tab` trae el nuevo
// (`Asia/Kolkata`). Si la búsqueda directa falla, se comparan los dos ya
// pasados por el mismo `Intl`. Se arma una sola vez y solo si hace falta.
let countryByCanonicalTimezone: Map<string, string> | undefined;

function canonicalTimezone(zone: string): string | undefined {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function countryFromTimezone(timeZone: string): string | undefined {
  const direct = COUNTRY_BY_TIMEZONE.get(timeZone);
  if (direct) {
    return direct;
  }
  const canonical = canonicalTimezone(timeZone);
  if (!canonical) {
    return undefined;
  }
  countryByCanonicalTimezone ??= new Map(
    [...COUNTRY_BY_TIMEZONE].flatMap(([zone, country]) => {
      const key = canonicalTimezone(zone);
      return key ? [[key, country] as const] : [];
    }),
  );
  return countryByCanonicalTimezone.get(canonical);
}

function countryFromLanguages(languages: readonly string[]): string | undefined {
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).region;
      if (region && ISO_COUNTRIES.has(region)) {
        return region;
      }
    } catch {
      // Una etiqueta de idioma mal formada no es pista de nada.
    }
  }
  return undefined;
}

export function countryFromSignals(timeZone: string, languages: readonly string[]): string {
  return (timeZone && countryFromTimezone(timeZone)) || countryFromLanguages(languages) || "";
}

export function detectBrowserCountry(): DetectedLocation {
  let timeZone = "";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    // Sin zona del sistema queda el idioma.
  }
  const languages =
    typeof navigator === "undefined"
      ? []
      : navigator.languages?.length
        ? navigator.languages
        : [navigator.language];
  return { country: countryFromSignals(timeZone, languages), timeZone };
}
