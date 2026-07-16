export const SUPPORTED_LOCALES = ["es", "en"] as const;
export const SUPPORTED_CURRENCIES = ["MXN", "USD"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

export const DEFAULT_LOCALE: Locale = "es";
export const DEFAULT_CURRENCY: Currency = "MXN";

const BCP47_BY_LOCALE: Record<Locale, string> = {
  es: "es-MX",
  en: "en-US",
};

/**
 * Maps an app `Locale` to its BCP-47 language tag.
 *
 * `es` maps to `es-MX` (not `es-ES`) because Mexico-first formatting uses
 * comma-thousands/dot-decimals; `es-ES` would use dot-thousands/comma-decimals
 * and break MXN/USD formatting consistency across the POS.
 */
export function localeToBcp47(locale: Locale): string {
  return BCP47_BY_LOCALE[locale];
}
