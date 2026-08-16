import type { CountryCode, Currency } from "@sellpoint/shared";
import { getCountryTimezones } from "./country-timezones";

/**
 * Ad-hoc post-Fase 1 (2026-08-16, decisiones de Carlos, MERCADOS.md §2 —
 * "El problema abierto: las etiquetas no son universales"). Los tres mapas
 * de mercado (zonas horarias curadas, moneda por defecto, sigla fiscal)
 * viven ACÁ — no en `step-business.tsx` — para que el componente quede
 * presentacional y esta lógica sea testeable sin React.
 *
 * `CuratedCountry` es el subconjunto de `CountryCode` (`@sellpoint/shared`,
 * catálogo ISO 3166-1 completo) para el que SellPoint tiene un catálogo
 * curado de zonas/moneda/sigla fiscal — los 26 países de MERCADOS.md §1. El
 * resto del catálogo ISO (~230 países) es "no curado": el país es un
 * `CountryCode` válido igual, pero cae a los fallbacks genéricos (zona
 * horaria completa de `Intl.supportedValuesOf`, moneda USD, etiqueta fiscal
 * sin sigla) — ver `isCuratedCountry`, `getCuratedTimezones`,
 * `getDefaultCurrency`, `getTaxIdAbbreviation`.
 */
export const CURATED_COUNTRIES = [
  // Norteamérica
  "MX",
  "US",
  "CA",
  // Europa
  "PT",
  "ES",
  "FR",
  "IT",
  "DE",
  "GB",
  // Centroamérica
  "BZ",
  "CR",
  "SV",
  "GT",
  "HN",
  "NI",
  "PA",
  // Sudamérica
  "AR",
  "BO",
  "BR",
  "CL",
  "CO",
  "EC",
  "PY",
  "PE",
  "UY",
  "VE",
] as const satisfies readonly CountryCode[];

export type CuratedCountry = (typeof CURATED_COUNTRIES)[number];

/**
 * Reorganización del `TIMEZONE_OPTIONS` plano que vivía en
 * `step-business.tsx` (decisión de Carlos, 2026-08-16) hacia un mapa
 * país→zonas — SIN perder ninguna de las 45 claves i18n existentes
 * (`onboarding.step1.timezoneOptions.*`, es/en). El componente sigue
 * traduciendo cada IANA id con esas mismas claves; este módulo solo decide
 * QUÉ subconjunto ofrecer según el país elegido.
 */
export const CURATED_TIMEZONES: Record<CuratedCountry, readonly string[]> = {
  MX: ["America/Mexico_City", "America/Cancun", "America/Hermosillo", "America/Tijuana"],
  US: [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
  ],
  CA: [
    "America/St_Johns",
    "America/Halifax",
    "America/Toronto",
    "America/Winnipeg",
    "America/Edmonton",
    "America/Vancouver",
  ],
  PT: ["Europe/Lisbon"],
  ES: ["Europe/Madrid", "Atlantic/Canary"],
  FR: ["Europe/Paris"],
  IT: ["Europe/Rome"],
  DE: ["Europe/Berlin"],
  GB: ["Europe/London"],
  BZ: ["America/Belize"],
  CR: ["America/Costa_Rica"],
  SV: ["America/El_Salvador"],
  GT: ["America/Guatemala"],
  HN: ["America/Tegucigalpa"],
  NI: ["America/Managua"],
  PA: ["America/Panama"],
  AR: ["America/Argentina/Buenos_Aires"],
  BO: ["America/La_Paz"],
  BR: ["America/Sao_Paulo", "America/Manaus", "America/Rio_Branco"],
  CL: ["America/Santiago", "Pacific/Easter"],
  CO: ["America/Bogota"],
  EC: ["America/Guayaquil", "Pacific/Galapagos"],
  PY: ["America/Asuncion"],
  PE: ["America/Lima"],
  UY: ["America/Montevideo"],
  VE: ["America/Caracas"],
};

/**
 * Decisión 5 (2026-08-16): preselección EDITABLE. Norteamérica y Europa
 * preseleccionan su moneda local (las 5 en `SUPPORTED_CURRENCIES`);
 * Centro/Sudamérica preseleccionan USD por decisión operativa (MERCADOS.md
 * §1, "Sobre la moneda por defecto") — sus monedas locales todavía no están
 * habilitadas. Un país NO curado también cae a USD (`getDefaultCurrency`).
 */
export const DEFAULT_CURRENCY_BY_COUNTRY: Record<CuratedCountry, Currency> = {
  MX: "MXN",
  US: "USD",
  CA: "CAD",
  PT: "EUR",
  ES: "EUR",
  FR: "EUR",
  IT: "EUR",
  DE: "EUR",
  GB: "GBP",
  BZ: "USD",
  CR: "USD",
  SV: "USD",
  GT: "USD",
  HN: "USD",
  NI: "USD",
  PA: "USD",
  AR: "USD",
  BO: "USD",
  BR: "USD",
  CL: "USD",
  CO: "USD",
  EC: "USD",
  PY: "USD",
  PE: "USD",
  UY: "USD",
  VE: "USD",
};

/**
 * Decisión 6 (2026-08-16): siglas EXACTAS del identificador fiscal local
 * por país curado — mueren "RFC / RUT" (RUT era de Chile/Uruguay, países que
 * NO soportábamos; y no nombraba a los otros ocho). Un país NO curado usa la
 * etiqueta genérica sin sigla (`getTaxIdAbbreviation` devuelve `undefined`)
 * — SIN validación de formato por país, fuera de alcance (MERCADOS.md §2,
 * opción B vs C).
 */
export const TAX_ID_ABBREVIATION_BY_COUNTRY: Record<CuratedCountry, string> = {
  MX: "RFC",
  US: "EIN",
  CA: "BN",
  PT: "NIF",
  ES: "NIF",
  FR: "SIREN/SIRET",
  IT: "Partita IVA",
  DE: "USt-IdNr",
  GB: "Company Number / VAT",
  BZ: "TIN",
  CR: "Cédula Jurídica",
  SV: "NIT",
  GT: "NIT",
  HN: "RTN",
  NI: "RUC",
  PA: "RUC",
  AR: "CUIT",
  BO: "NIT",
  BR: "CNPJ",
  CL: "RUT",
  CO: "NIT",
  EC: "RUC",
  PY: "RUC",
  PE: "RUC",
  UY: "RUT",
  VE: "RIF",
};

export function isCuratedCountry(country: string): country is CuratedCountry {
  return Object.hasOwn(CURATED_TIMEZONES, country);
}

/** `undefined` para un país no curado — el caller usa el mapa IANA o el catálogo completo. */
export function getCuratedTimezones(country: string): readonly string[] | undefined {
  return isCuratedCountry(country) ? CURATED_TIMEZONES[country] : undefined;
}

/**
 * Zonas horarias de CUALQUIER país, curado o no (decisión de Carlos,
 * 2026-08-16): elegir Japón debe dejar `Asia/Tokyo`, no las 418 del mundo.
 *
 * Precedencia: para un país curado manda su lista a mano —más corta y con
 * etiqueta propia— sobre la de IANA (México tiene 12 zonas IANA y nosotros
 * ofrecemos 4). Para el resto, la de IANA. `undefined` solo si IANA no
 * registra ninguna (territorios deshabitados como Isla Bouvet), y ahí el
 * caller cae al catálogo completo para no dejar al usuario sin opciones.
 */
export function resolveCountryTimezones(country: string): readonly string[] | undefined {
  return getCuratedTimezones(country) ?? getCountryTimezones(country);
}

/** Un país no curado (o vacío) cae a USD — mismo criterio que Centro/Sudamérica. */
export function getDefaultCurrency(country: string): Currency {
  return isCuratedCountry(country) ? DEFAULT_CURRENCY_BY_COUNTRY[country] : "USD";
}

/** `undefined` para un país no curado — el caller arma la etiqueta genérica sin sigla. */
export function getTaxIdAbbreviation(country: string): string | undefined {
  return isCuratedCountry(country) ? TAX_ID_ABBREVIATION_BY_COUNTRY[country] : undefined;
}
