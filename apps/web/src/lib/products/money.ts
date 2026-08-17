import { hasValidMoneyScale, MONEY_MAX } from "@sellpoint/shared";

/**
 * Paso de los inputs de importe: las flechitas del `type="number"` se mueven de
 * a un centavo, y el navegador marca inválido lo que no cae en la grilla. Es la
 * primera barrera —la nuestra sigue abajo, porque `step` no impide TIPEAR un
 * número con tres decimales, solo lo señala.
 */
export const MONEY_STEP = "0.01";

/**
 * ¿Qué le pasa a este importe? Devuelve la CLAVE i18n del problema, o `null` si
 * no hay ninguno.
 *
 * Devuelve la clave y no un booleano porque los dos límites de `DECIMAL(14,2)`
 * fallan por motivos distintos: decir "admite 2 decimales" cuando lo que no
 * entra es la magnitud manda al usuario a mirar el lugar equivocado.
 *
 * Trabaja sobre el string crudo del `<input>`, no sobre un número, porque eso
 * es lo que hay mientras se escribe. Vacío y a-medio-escribir NO son error: el
 * campo es opcional, y marcar en rojo a alguien que todavía está tipeando es
 * ruido.
 */
export function moneyScaleError(raw: string): string | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const amount = Number(text);
  if (Number.isNaN(amount)) {
    return null;
  }
  if (Math.abs(amount) > MONEY_MAX) {
    return "products.amount_too_large";
  }
  return hasValidMoneyScale(amount) ? null : "products.too_many_decimals";
}
