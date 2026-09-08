import {
  formatMoneyInput,
  hasValidMoneyScale,
  MONEY_MAX,
  parseMoneyInput,
} from "@sellpoint/shared";

/**
 * Paso de los inputs de importe que todavía son `type="number"`: las flechitas
 * se mueven de a un centavo. Hoy lo usa solo el costo unitario de una línea de
 * documento de inventario; los catálogos pasaron a `MoneyField` (Carlos,
 * 2026-09-07), que no tiene flechitas ni necesita paso.
 */
export const MONEY_STEP = "0.01";

/**
 * ¿Qué le pasa a este importe? Devuelve la CLAVE i18n del problema, o `null` si
 * no hay ninguno.
 *
 * Devuelve la clave y no un booleano porque los tres problemas fallan por
 * motivos distintos: decir "admite 2 decimales" cuando lo que no entra es la
 * magnitud —o cuando lo que se escribió es una coma— manda al usuario a mirar
 * el lugar equivocado.
 *
 * Trabaja sobre el string crudo del `<input>`, no sobre un número, porque eso
 * es lo que hay mientras se escribe. Vacío NO es error: el campo es opcional.
 * Y desde que el campo es de texto (`inputMode="decimal"`), lo que no es un
 * importe SÍ es error del formulario: ya no hay un `type="number"` que lo
 * frene antes.
 */
export function moneyInputError(raw: string): string | null {
  if (raw.trim() === "") {
    return null;
  }
  const amount = parseMoneyInput(raw);
  if (amount === null) {
    return "products.invalid_amount";
  }
  if (amount > MONEY_MAX) {
    return "products.amount_too_large";
  }
  return hasValidMoneyScale(amount) ? null : "products.too_many_decimals";
}

/**
 * El texto con el que ARRANCA un campo de importe al abrir un registro
 * guardado. El API devuelve `Prisma.Decimal.toString()`, que no rellena ceros
 * (`"45"`, `"0.5"`): si el campo promete dos decimales, tiene que cumplirlo
 * también al cargar y no solo después de que el usuario lo toque. Lo que no se
 * puede formatear —`null`, vacío— arranca vacío.
 */
export function moneyInitialValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  return formatMoneyInput(value) ?? value;
}
