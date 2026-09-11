import { UnprocessableEntityException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";

/** Una partida con lo que trae del papel: producto, lote y caducidad (o nada). */
export interface PartidaConLote {
  productId: string;
  lotCode: string | null;
  expiresAt: string | null;
}

export interface LoteResuelto {
  lotCode: string | null;
  expiresAt: Date | null;
}

/** Lo que el helper consulta: dos tablas, en la MISMA transacción del que llama. */
type TxDeLotes = Pick<Prisma.TransactionClient, "product" | "productLot">;

/**
 * Las reglas de LOTE que comparten la compra y la recepción (Carlos,
 * 2026-09-11) — extraídas de `purchase-lines.service.ts` sin cambiar nada:
 *
 *  1. Un lote (o una caducidad sola) en un producto que NO se controla por
 *     lote rebota, nombrando la línea. «Transportar» tiene un límite: eso no
 *     es un dato que la entrada vaya a exigir, es uno que va a RECHAZAR, y
 *     descubrirlo con el papel ya sellado es descubrirlo tarde.
 *  2. La caducidad es del LOTE, no de la línea: si el lote ya existe en el
 *     registro —con o sin existencias—, una línea sin fecha la HEREDA y una
 *     con otra fecha rebota (adivinar cuál está mal sería peor que preguntar).
 *
 * Los mensajes viven en el namespace `purchases`: la recepción es de la misma
 * familia y el texto es el mismo para las dos.
 */
export async function aplicarReglasDeLote(
  tx: TxDeLotes,
  tenantId: string,
  partidas: readonly PartidaConLote[],
  campo: (index: number) => string = (i) => `lines.${i + 1}`,
): Promise<LoteResuelto[]> {
  if (partidas.length === 0) return [];
  const productos = await tx.product.findMany({
    where: { tenantId, id: { in: [...new Set(partidas.map((p) => p.productId))] } },
    select: { id: true, tracksLots: true },
  });
  const controla = new Map(productos.map((p) => [p.id, p.tracksLots]));
  const conLote = partidas.filter((p) => (p.lotCode ?? "") !== "");
  const conocidos =
    conLote.length === 0
      ? []
      : await tx.productLot.findMany({
          where: {
            tenantId,
            OR: conLote.map((p) => ({ productId: p.productId, lotCode: p.lotCode as string })),
          },
          select: { productId: true, lotCode: true, expiresAt: true },
        });
  const caducidadDe = new Map(
    conocidos.map((lot) => [`${lot.productId}|${lot.lotCode}`, lot.expiresAt]),
  );

  return partidas.map((partida, index) => {
    const traeLote = (partida.lotCode ?? "") !== "" || partida.expiresAt !== null;
    if (traeLote && controla.get(partida.productId) !== true) {
      throw new UnprocessableEntityException({
        message: "purchases.lot_not_tracked",
        args: { field: `${campo(index)}.lotCode` },
      });
    }
    let expiresAt = partida.expiresAt === null ? null : new Date(partida.expiresAt);
    const clave = `${partida.productId}|${partida.lotCode ?? ""}`;
    if (traeLote && caducidadDe.has(clave)) {
      const guardada = caducidadDe.get(clave) ?? null;
      const pedida = expiresAt?.toISOString().slice(0, 10) ?? null;
      const conocida = guardada?.toISOString().slice(0, 10) ?? null;
      if (pedida !== null && conocida !== null && pedida !== conocida) {
        throw new UnprocessableEntityException({
          message: "purchases.lot_expiry_mismatch",
          args: { field: `${campo(index)}.expiresAt`, lotCode: partida.lotCode },
        });
      }
      if (pedida === null) expiresAt = guardada;
    }
    return { lotCode: partida.lotCode ?? null, expiresAt };
  });
}
