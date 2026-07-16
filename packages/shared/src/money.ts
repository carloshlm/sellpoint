import {
  type Currency,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  type Locale,
  localeToBcp47,
} from "./i18n";

/**
 * Formats a monetary amount for display (presentation-only helper).
 *
 * Uses `Intl.NumberFormat` with `currencyDisplay: "symbol"` (the default):
 * the native pair (MXN/es, USD/en) renders the shared `"$"` symbol, while a
 * foreign pair gets ICU's own disambiguation (e.g. `"MX$"`, or an ISO-code
 * fallback like `"USD "` when no narrow symbol exists for that locale).
 *
 * Rounding uses ICU's default `halfExpand` behavior — this function does not
 * reimplement monetary rounding, which belongs to the domain layer.
 *
 * @throws {RangeError} if `amount` is not finite (NaN, Infinity, -Infinity).
 */
export function formatMoney(
  amount: number,
  currency: Currency = DEFAULT_CURRENCY,
  locale: Locale = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`formatMoney: amount must be finite, received ${amount}`);
  }

  return new Intl.NumberFormat(localeToBcp47(locale), {
    style: "currency",
    currency,
  }).format(amount);
}
