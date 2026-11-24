import { UnprocessableEntityException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";

/**
 * F10-NOPRICE (Carlos, 2026-11-24): lo que no tiene precio no se vende ni se
 * cotiza. Antes la caja lo cobraba en $0.00 y aun así descontaba el stock: una
 * bolsa de 10 kg salía regalada porque nadie le puso precio. Vale también para
 * el producto sin precio, que es su presentación base sin precio («si,
 * aplícala también al producto»).
 *
 * Un cero ESCRITO sí es precio: es una decisión, no un olvido.
 */
export function assertHasSalePrice<P extends { name: string; price: Prisma.Decimal | null }>(
  product: { name: string; sku: string },
  presentation: P,
  lineIndex: number,
): asserts presentation is P & { price: Prisma.Decimal } {
  if (presentation.price === null) {
    throw new UnprocessableEntityException({
      message: "pos.presentation_without_price",
      args: { productName: product.name, presentationName: presentation.name, lineIndex },
      // El renglón culpable como DATO, como el error de existencias: la caja
      // lo marca con «El servidor rechazó esta línea».
      sku: product.sku,
    });
  }
}
