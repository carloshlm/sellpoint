import { UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import type { ExpandedLine } from "./composition-expander";

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
/** Un lote candidato con su saldo, ya ordenado FEFO. */
interface LotCandidate {
  product_id: string;
  lot_id: string;
  lot_code: string;
  expires_at: Date | null;
  location: string;
  quantity: string;
}

/** Lo que una línea toma de UN lote concreto. */
export interface FefoTake {
  lotId: string;
  lotCode: string;
  expiresAt: Date | null;
  location: string;
  quantity: Prisma.Decimal;
}

/** El reparto de una línea: de dónde sale, y cuánto faltó si no alcanzó. */
export interface FefoLinePlan {
  lineIndex: number;
  takes: FefoTake[];
  /** `0` si el reparto se completó. */
  shortfall: Prisma.Decimal;
}

/**
 * Los lotes con saldo de esos productos, en orden FEFO.
 *
 * `expires_at ASC NULLS LAST`, desempate por `lot_code` y `location`. Un lote
 * sin caducidad no es "el más urgente" sino lo contrario: no corre riesgo de
 * vencerse, así que sale cuando ya no queda nada que sí lo corra. El desempate
 * por código existe para que dos corridas con los mismos datos den el mismo
 * resultado — un reparto no determinista sería imposible de auditar.
 */
async function fetchCandidates(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  productIds: string[],
): Promise<Map<string, LotCandidate[]>> {
  const rows = await tx.$queryRaw<LotCandidate[]>`
    SELECT pl.product_id, sl.lot_id, pl.lot_code, pl.expires_at, sl.location,
           sl.quantity::text AS quantity
      FROM stock_lots sl
      JOIN product_lots pl ON pl.id = sl.lot_id
     WHERE sl.tenant_id = ${tenantId}::uuid
       AND sl.warehouse_id = ${warehouseId}::uuid
       AND pl.product_id = ANY(${productIds}::uuid[])
       AND sl.quantity > 0
     ORDER BY pl.expires_at ASC NULLS LAST, pl.lot_code ASC, sl.location ASC`;

  const porProducto = new Map<string, LotCandidate[]>();
  for (const row of rows) {
    const actual = porProducto.get(row.product_id) ?? [];
    actual.push(row);
    porProducto.set(row.product_id, actual);
  }
  return porProducto;
}

/**
 * **El reparto, y NADA más.** Función pura: no consulta, no tira excepciones,
 * no escribe. Devuelve de qué lote sale cada línea y cuánto faltó.
 *
 * Existe separada porque la usan DOS caminos con exigencias opuestas: el
 * `confirm`, que ante un faltante tiene que abortar el movimiento entero, y la
 * VISTA PREVIA, que tiene que juntar los problemas de todas las líneas sin
 * cortar en la primera. Si cada uno tuviera su propio reparto, lo que el
 * usuario ve antes de confirmar y lo que se asienta podrían diferir — que es
 * exactamente lo que la previa vino a evitar (mismo criterio que `resolveLines`
 * con su modo `preview`).
 */
export function allocateFefo(
  candidatesByProduct: Map<string, LotCandidate[]>,
  lines: { lineIndex: number; productId: string; quantityBase: Prisma.Decimal }[],
): FefoLinePlan[] {
  // Lo ya comprometido por líneas anteriores del MISMO movimiento: dos líneas
  // del mismo producto no pueden repartirse el mismo saldo dos veces.
  const comprometido = new Map<string, Prisma.Decimal>();
  const planes: FefoLinePlan[] = [];

  for (const line of lines) {
    const candidatos = candidatesByProduct.get(line.productId) ?? [];
    const takes: FefoTake[] = [];
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

      takes.push({
        lotId: candidato.lot_id,
        lotCode: candidato.lot_code,
        expiresAt: candidato.expires_at,
        location: candidato.location,
        quantity: toma,
      });
    }

    planes.push({
      lineIndex: line.lineIndex,
      takes,
      // Un producto SIN lotes no es un faltante: simplemente no es asunto de
      // FEFO. Si controla lotes y no hay saldo, lo rechaza el ledger al validar.
      shortfall: candidatos.length === 0 ? new Prisma.Decimal(0) : restante,
    });
  }

  return planes;
}

/**
 * El reparto FEFO en modo PREVIA: qué lotes se usarían, sin escribir ni tirar.
 *
 * Es lo que la pantalla del documento muestra por línea ("saldrá 1 del lote
 * st10, vence 01/07/2026") para que quien confirma vea de dónde va a salir la
 * mercancía ANTES de que salga.
 */
export async function planLotsFefo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  lines: { lineIndex: number; productId: string; quantityBase: Prisma.Decimal }[],
): Promise<FefoLinePlan[]> {
  if (lines.length === 0) {
    return [];
  }
  const candidatos = await fetchCandidates(tx, tenantId, warehouseId, [
    ...new Set(lines.map((l) => l.productId)),
  ]);
  return allocateFefo(candidatos, lines);
}

export async function resolveLotsFefo(
  tx: Prisma.TransactionClient,
  tenantId: string,
  warehouseId: string,
  lines: ExpandedLine[],
): Promise<ExpandedLine[]> {
  // Solo las líneas que NO traen lote forzado necesitan reparto. El resto
  // pasa tal cual: si el usuario eligió un lote, sabe algo que el sistema no.
  const necesitanFefo = lines.filter((l) => l.lotId === undefined);
  if (necesitanFefo.length === 0) {
    return lines;
  }

  const candidatos = await fetchCandidates(tx, tenantId, warehouseId, [
    ...new Set(necesitanFefo.map((l) => l.productId)),
  ]);

  // El MISMO reparto que ve la previa. Que sea una sola función es lo que
  // garantiza que lo previsualizado y lo asentado coincidan.
  const planes = allocateFefo(
    candidatos,
    necesitanFefo.map((line, index) => ({
      lineIndex: index,
      productId: line.productId,
      quantityBase: line.quantityBase,
    })),
  );

  const resultado: ExpandedLine[] = [];
  let siguiente = 0;

  for (const line of lines) {
    if (line.lotId !== undefined) {
      resultado.push(line);
      continue;
    }

    const plan = planes[siguiente] as FefoLinePlan;
    siguiente += 1;

    if (plan.shortfall.greaterThan(0)) {
      throw new UnprocessableEntityException({
        message: "inventory.insufficient_stock",
        args: {
          productId: line.productId,
          sku: line.sku,
          available: line.quantityBase.minus(plan.shortfall).toString(),
          requested: line.quantityBase.toString(),
          lineIndex: line.lineIndex,
        },
      });
    }

    // Un producto sin lotes pasa de largo, entero y sin tocar.
    if (plan.takes.length === 0) {
      resultado.push(line);
      continue;
    }

    for (const take of plan.takes) {
      resultado.push({
        ...line,
        // El índice de la línea ORIGINAL: el error de una sublínea tiene que
        // pintarse sobre la fila que el usuario ve, no sobre una que inventamos.
        lineIndex: line.lineIndex,
        quantityBase: take.quantity,
        lotId: take.lotId,
        location: take.location,
      });
    }
  }

  return resultado;
}
