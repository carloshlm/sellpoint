import { UnprocessableEntityException } from "@nestjs/common";
import { QUANTITY_DECIMALS } from "@sellpoint/shared";
import { Prisma } from "../generated/prisma/client";

/**
 * Una cantidad tiene que caber en su PRESENTACIÓN (Carlos, 2026-09-13).
 *
 * Dos reglas, una sola puerta:
 *
 * 1. Media pieza no existe. Si la presentación no admite fracciones
 *    (`allow_fractional_input`, que sale de la categoría de la unidad:
 *    `count` no se parte), la cantidad tiene que ser entera. Inventario y el
 *    punto de venta ya lo exigían (`line-resolver.ts`, `sales.service.ts`);
 *    órdenes de compra, recepciones y compras no, y por ahí entraban.
 *
 * 2. La columna es `DECIMAL(14,4)`. Un quinto decimal no rebota: Postgres lo
 *    REDONDEA en silencio, y el número guardado deja de ser el tecleado. Más
 *    vale un 422 que un kardex que no cuadra por milésimas.
 */
export function assertQuantityFitsPresentation(
  quantity: Prisma.Decimal,
  opciones: {
    allowFractionalInput: boolean;
    /** Cómo nombrarla en el mensaje: la presentación, o la unidad base. */
    presentationName: string;
    /** Clave i18n del namespace de quien llama. */
    integerMessage: string;
    scaleMessage: string;
    /** Para que el mensaje señale la línea y el campo. */
    args?: Record<string, unknown>;
  },
): void {
  if (!opciones.allowFractionalInput && !quantity.isInteger()) {
    throw new UnprocessableEntityException({
      message: opciones.integerMessage,
      args: { presentationName: opciones.presentationName, ...opciones.args },
    });
  }
  if (quantity.decimalPlaces() > QUANTITY_DECIMALS) {
    throw new UnprocessableEntityException({
      message: opciones.scaleMessage,
      args: { decimals: QUANTITY_DECIMALS, ...opciones.args },
    });
  }
}
