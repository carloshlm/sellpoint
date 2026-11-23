import { Prisma } from "../../generated/prisma/client";

/** F10-CASHMOV-03 — lo que entró y lo que salió del cajón de un turno sin ser venta ni gasto. */
export interface SessionCashMovements {
  /** Σ de las entradas activas, como texto decimal («0» sin entradas). */
  cashIn: string;
  /** Σ de los retiros activos, como texto decimal («0» sin retiros). */
  cashOut: string;
}

type Tx = Pick<Prisma.TransactionClient, "cashMovement">;

/**
 * F10-CASHMOV-03 — las entradas y los retiros de efectivo de uno o varios
 * turnos, en UNA consulta. El arqueo los lleva a `efectivoEsperado`: sin
 * ellos, el efectivo que se lleva a la caja fuerte salía como faltante.
 *
 * Lee la TABLA con un `Pick` del TransactionClient, como
 * `gastosEnEfectivoPorSesion`: así el cierre del punto de venta y los reportes
 * usan la misma suma sin importar ningún módulo.
 *
 * Solo los ACTIVOS: uno anulado ya no movió nada.
 */
export async function movimientosPorSesion(
  tx: Tx,
  tenantId: string,
  sessionIds: readonly string[],
): Promise<Map<string, SessionCashMovements>> {
  const resultado = new Map<string, SessionCashMovements>();
  if (sessionIds.length === 0) {
    return resultado;
  }
  const filas = await tx.cashMovement.groupBy({
    by: ["cashboxSessionId", "type"],
    where: { tenantId, cashboxSessionId: { in: [...sessionIds] }, status: "active" },
    _sum: { amount: true },
  });
  const suma = (id: string, type: "in" | "out") =>
    new Prisma.Decimal(
      filas.find((f) => f.cashboxSessionId === id && f.type === type)?._sum.amount ?? 0,
    ).toString();
  for (const id of sessionIds) {
    resultado.set(id, { cashIn: suma(id, "in"), cashOut: suma(id, "out") });
  }
  return resultado;
}

/** Sin movimientos: lo que devuelve un turno al que no entró ni del que salió nada. */
export function sinMovimientos(): SessionCashMovements {
  return { cashIn: "0", cashOut: "0" };
}
