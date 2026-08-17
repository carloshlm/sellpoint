import { hasValidMoneyScale } from "@sellpoint/shared";
import { z } from "zod";

/**
 * Escala de los importes: la REGLA vive en `@sellpoint/shared` porque entra por
 * las dos puntas (el formulario avisa mientras se escribe, el API rechaza).
 * Acá queda solo su forma de esquema Zod, que es lo único específico del API.
 *
 * La regla llega al backend por CUATRO puertas —alta y edición de producto,
 * alta y edición de presentación— más la importación por planilla. Un solo
 * `moneyAmount()` es lo que evita que un día se corrija en tres de las cinco.
 */
export { hasValidMoneyScale, MONEY_DECIMALS } from "@sellpoint/shared";

/** Importe no negativo con, como mucho, dos decimales. */
export function moneyAmount() {
  return z.number().nonnegative().refine(hasValidMoneyScale, {
    message: "products.too_many_decimals",
  });
}
