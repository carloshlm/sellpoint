import {
  type Currency,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  type Locale,
  localeToBcp47,
} from "./i18n";

/**
 * Decimales que admite un importe en todo el sistema.
 *
 * No es cosmético: `price` y `cost` son `DECIMAL(14,2)` en la base, y Postgres
 * **redondea en silencio** lo que no entra — mandar `15.555` guarda `15.56` sin
 * avisar. Validar contra esta constante es lo que convierte ese redondeo mudo
 * en un error que el usuario puede corregir.
 */
export const MONEY_DECIMALS = 2;

/**
 * ¿El importe cabe en la escala del sistema?
 *
 * Vive en `shared` porque la regla entra por las dos puntas: el formulario la
 * usa para avisar mientras se escribe y el API para rechazar. Tenerla dos veces
 * es garantizar que un día se corrija en una sola.
 *
 * Se compara la ida y vuelta por `toFixed` en vez de multiplicar por 100:
 * `1.15 * 100` da `114.99999999999999` en IEEE-754, así que la cuenta ingenua
 * rechazaría precios perfectamente válidos. El paso por string, además, atrapa
 * la notación exponencial (`1e-7`), que no tiene punto pero sí decimales.
 */
export function hasValidMoneyScale(amount: number): boolean {
  if (!Number.isFinite(amount)) {
    return false;
  }
  return Number(amount.toFixed(MONEY_DECIMALS)) === amount;
}

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
