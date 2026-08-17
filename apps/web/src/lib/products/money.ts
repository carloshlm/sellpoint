import { hasValidMoneyScale } from "@sellpoint/shared";

/**
 * Paso de los inputs de importe: las flechitas del `type="number"` se mueven de
 * a un centavo, y el navegador marca inválido lo que no cae en la grilla. Es la
 * primera barrera —la nuestra sigue abajo, porque `step` no impide TIPEAR un
 * número con tres decimales, solo lo señala.
 */
export const MONEY_STEP = "0.01";

/**
 * ¿El texto del input es un importe con demasiados decimales?
 *
 * Trabaja sobre el string crudo del `<input>`, no sobre un número, porque eso
 * es lo que hay mientras se escribe. Vacío y a-medio-escribir NO son error: el
 * campo es opcional, y marcar en rojo a alguien que todavía está tipeando es
 * ruido. Lo que no cabe es un número completo y válido que excede la escala.
 */
export function moneyScaleError(raw: string): boolean {
  const text = raw.trim();
  if (!text) {
    return false;
  }
  const amount = Number(text);
  if (Number.isNaN(amount)) {
    return false;
  }
  return !hasValidMoneyScale(amount);
}
