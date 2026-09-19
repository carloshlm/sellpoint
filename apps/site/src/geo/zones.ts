// Las zonas horarias (IANA) de los tres mercados. Es la pista principal para
// sugerir un país SIN pedir la IP: el navegador la da sin permisos y sin avisos,
// y no hay una base GeoIP que licenciar ni actualizar (IMPLEMENTACION.md,
// F11-SITE, decisión 3).
//
// Incluye los alias viejos (`America/Montreal`, `Canada/Eastern`,
// `Mexico/General`, `US/Pacific`): algunos sistemas todavía los reportan.
import type { MarketId } from "../config/markets";

const MX = new Set([
  "America/Mexico_City",
  "America/Cancun",
  "America/Merida",
  "America/Monterrey",
  "America/Matamoros",
  "America/Chihuahua",
  "America/Ciudad_Juarez",
  "America/Ojinaga",
  "America/Mazatlan",
  "America/Bahia_Banderas",
  "America/Hermosillo",
  "America/Tijuana",
  "America/Ensenada",
  "America/Santa_Isabel",
]);

const CA = new Set([
  "America/St_Johns",
  "America/Halifax",
  "America/Glace_Bay",
  "America/Moncton",
  "America/Goose_Bay",
  "America/Blanc-Sablon",
  "America/Toronto",
  "America/Montreal",
  "America/Nipigon",
  "America/Thunder_Bay",
  "America/Iqaluit",
  "America/Pangnirtung",
  "America/Atikokan",
  "America/Coral_Harbour",
  "America/Winnipeg",
  "America/Rainy_River",
  "America/Resolute",
  "America/Rankin_Inlet",
  "America/Regina",
  "America/Swift_Current",
  "America/Edmonton",
  "America/Cambridge_Bay",
  "America/Yellowknife",
  "America/Inuvik",
  "America/Creston",
  "America/Dawson_Creek",
  "America/Fort_Nelson",
  "America/Whitehorse",
  "America/Dawson",
  "America/Vancouver",
]);

const US = new Set([
  "America/New_York",
  "America/Detroit",
  "America/Chicago",
  "America/Menominee",
  "America/Denver",
  "America/Boise",
  "America/Shiprock",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Juneau",
  "America/Sitka",
  "America/Metlakatla",
  "America/Yakutat",
  "America/Nome",
  "America/Adak",
  "America/Atka",
  "America/Louisville",
  "America/Indianapolis",
  "America/Fort_Wayne",
  "America/Knox_IN",
  "Pacific/Honolulu",
  "Pacific/Johnston",
]);

/** Prefijos que son de un solo país: `America/Indiana/Knox`, `Canada/Pacific`… */
const PREFIXES: [string, MarketId][] = [
  ["America/Indiana/", "us"],
  ["America/Kentucky/", "us"],
  ["America/North_Dakota/", "us"],
  ["US/", "us"],
  ["Canada/", "ca"],
  ["Mexico/", "mx"],
];

/** El mercado de una zona horaria, o `null` si es de otro país o no dice nada. */
export function marketOfTimeZone(timeZone: string | undefined): MarketId | null {
  if (!timeZone) return null;
  if (MX.has(timeZone)) return "mx";
  if (CA.has(timeZone)) return "ca";
  if (US.has(timeZone)) return "us";
  return PREFIXES.find(([prefix]) => timeZone.startsWith(prefix))?.[1] ?? null;
}

/**
 * Las zonas que no dicen dónde está nadie: `UTC`, `Etc/GMT+6`… Las reportan
 * los navegadores que esconden la zona real para que no se pueda rastrear a
 * la persona. Con ellas se cae a la pista del idioma.
 */
export function isNeutralTimeZone(timeZone: string | undefined): boolean {
  return !timeZone || timeZone === "UTC" || timeZone.startsWith("Etc/") || timeZone === "GMT";
}
