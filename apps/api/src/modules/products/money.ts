import { hasValidMoneyScale, MONEY_MAX } from "@sellpoint/shared";
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
export { hasValidMoneyScale, MONEY_DECIMALS, MONEY_MAX } from "@sellpoint/shared";

/**
 * Importe no negativo que cabe en `DECIMAL(14,2)`.
 *
 * Los dos límites se validan por SEPARADO porque fallan por motivos distintos y
 * el usuario necesita saber cuál le tocó: "admite 2 decimales" sería una
 * mentira si lo que escribió fue un billón. El `.max()` corre antes que el
 * `refine`, así que un número enorme con decimales de más reporta el problema
 * más grave.
 */
export function moneyAmount() {
  return z
    .number()
    .nonnegative()
    .max(MONEY_MAX, "products.amount_too_large")
    .refine(hasValidMoneyScale, { message: "products.too_many_decimals" });
}
