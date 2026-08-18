import { UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ResolvedLine } from "./line-resolver";

/**
 * F3-CORE-08 — FEFO: *First Expired, First Out*.
 *
 * Nace de un pedido concreto de Carlos sobre un Excel real de cliente: el
 * producto con lotes st30 / st10 / st60 y el requisito **"al vender, tiene que
 * restar del que vence el 01/07"**. Lo que se despacha primero es lo que se
 * echa a perder primero, no lo que llegó primero.
 *
 * ── Por qué vive en el LEDGER y no en el POS ────────────────────────────
 *
 * Si esto estuviera en la pantalla de venta, una salida por merma o un
 * traspaso elegirían el lote de otra manera —o se lo pedirían al usuario— y el
 * inventario dejaría de tener una sola regla. Acá, **el POS de F4 lo hereda
 * sin escribir una línea** y sin preguntarle nada al cajero.
 *
 * ── El orden, y por qué los sin fecha van al final ──────────────────────
 *
 * `expires_at ASC NULLS LAST`, desempate por `lot_code` y `location`. Un lote
 * sin caducidad no es "el más urgente" sino lo contrario: no corre riesgo de
 * vencerse, así que sale cuando ya no queda nada que sí lo corra. El desempate
 * por código existe para que dos corridas con los mismos datos den el mismo
 * resultado — un reparto no determinista sería imposible de auditar.
 *
 * Se ejecuta DENTRO de la transacción del ledger y las filas elegidas entran
 * al mismo `FOR UPDATE` que el resto: si dos salidas compiten por el mismo
 * lote, el lock las ordena y la segunda relee el saldo ya descontado.
 */
export async function resolveLotsFefo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  lines: ResolvedLine[],
): Promise<ResolvedLine[]> {
  // Solo las líneas que NO traen lote forzado necesitan reparto. El resto
  // pasa tal cual: si el usuario eligió un lote, sabe algo que el sistema no.
  const necesitanFefo = lines.filter((l) => l.lotId === undefined);
  if (necesitanFefo.length === 0) {
    return lines;
  }

  const productIds = [...new Set(necesitanFefo.map((l) => l.productId))];
  const disponibles = await tx.$queryRaw<
    { product_id: string; lot_id: string; location: string; quantity: string }[]
  >`
    SELECT pl.product_id, sl.lot_id, sl.location, sl.quantity::text AS quantity
      FROM stock_lots sl
      JOIN product_lots pl ON pl.id = sl.lot_id
     WHERE sl.tenant_id = ${tenantId}::uuid
       AND sl.warehouse_id = ${warehouseId}::uuid
       AND pl.product_id = ANY(${productIds}::uuid[])
       AND sl.quantity > 0
     ORDER BY pl.expires_at ASC NULLS LAST, pl.lot_code ASC, sl.location ASC`;

  const porProducto = new Map<string, typeof disponibles>();
  for (const row of disponibles) {
    const actual = porProducto.get(row.product_id) ?? [];
    actual.push(row);
    porProducto.set(row.product_id, actual);
  }

  // Lo ya comprometido por líneas anteriores del MISMO movimiento: dos líneas
  // del mismo producto no pueden repartirse el mismo saldo dos veces.
  const comprometido = new Map<string, Prisma.Decimal>();
  const resultado: ResolvedLine[] = [];

  for (const line of lines) {
    if (line.lotId !== undefined) {
      resultado.push(line);
      continue;
    }

    const candidatos = porProducto.get(line.productId);
    if (candidatos === undefined || candidatos.length === 0) {
      // Producto sin lotes (o sin saldo por lote): no es asunto de FEFO. Si el
      // producto controla lotes y no hay saldo, el ledger lo rechaza al validar.
      resultado.push(line);
      continue;
    }

    let restante = line.quantityBase;
    for (const candidato of candidatos) {
      if (restante.lessThanOrEqualTo(0)) {
        break;
      }
      const key = `${candidato.lot_id}|${candidato.location}`;
      const usado = comprometido.get(key) ?? new Prisma.Decimal(0);
      const libre = new Prisma.Decimal(candidato.quantity).minus(usado);
      if (libre.lessThanOrEqualTo(0)) {
        continue;
      }

      const toma = Prisma.Decimal.min(libre, restante);
      comprometido.set(key, usado.plus(toma));
      restante = restante.minus(toma);

      resultado.push({
        ...line,
        // El índice de la línea ORIGINAL: el error de una sublínea tiene que
        // pintarse sobre la fila que el usuario ve, no sobre una que inventamos.
        lineIndex: line.lineIndex,
        quantityBase: toma,
        lotId: candidato.lot_id,
        location: candidato.location,
      });
    }

    if (restante.greaterThan(0)) {
      throw new UnprocessableEntityException({
        message: "inventory.insufficient_stock",
        args: {
          productId: line.productId,
          sku: line.sku,
          available: line.quantityBase.minus(restante).toString(),
          requested: line.quantityBase.toString(),
          lineIndex: line.lineIndex,
        },
      });
    }
  }

  return resultado;
}
