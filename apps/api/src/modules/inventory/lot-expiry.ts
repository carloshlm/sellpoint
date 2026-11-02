import { BadRequestException, UnprocessableEntityException } from "@nestjs/common";
import { lotExpiryIsoDate, lotExpiryProblem } from "@sellpoint/shared";

/**
 * Rechaza una caducidad que no sirve; si sirve, no hace nada. Las reglas
 * viven en `@sellpoint/shared` (`lot-expiry.ts`): acá solo se traducen a la
 * excepción y al mensaje del API.
 *
 * El año fuera de 2000–2099 es **400**: el dato está mal escrito, como
 * cualquier campo mal formado. La fecha pasada es **422**: el dato es bueno,
 * lo que no se permite es la operación — el mismo reparto del resto del API.
 *
 * `namespace` elige la familia del mensaje: los del inventario no nombran la
 * línea porque la pantalla los pinta sobre la fila; los de compras y
 * recepciones sí («Línea 2: …»), como el resto de sus errores de línea.
 */
export function assertLotExpiry(
  value: string | Date,
  options: {
    rejectPast: boolean;
    namespace: "inventory" | "purchases";
    args?: Record<string, unknown>;
  },
): void {
  const problema = lotExpiryProblem(value, { rejectPast: options.rejectPast });
  if (problema === null) {
    return;
  }
  const body = {
    message:
      problema === "year_out_of_range"
        ? `${options.namespace}.expiry_year_out_of_range`
        : `${options.namespace}.expiry_in_past`,
    args: { ...options.args, expiresAt: lotExpiryIsoDate(value) },
  };
  throw problema === "year_out_of_range"
    ? new BadRequestException(body)
    : new UnprocessableEntityException(body);
}
