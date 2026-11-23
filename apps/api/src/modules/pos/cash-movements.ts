import { shortName } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import type { CashMovementReasonCode, CashMovementTypeCode } from "./dto/cash-movement.dto";

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

/** Quién: el id y el nombre corto, como en los gastos del cajón. */
export interface CashMovementPerson {
  id: string;
  name: string;
}

/**
 * F10-CASHMOV-02 — un movimiento de efectivo como lo ve el web. Es el contrato
 * de L5 (`odd/tasks/f10-cashmov.md`), en ese orden: el web de F10-CASHMOV-04 y
 * el de «Cierres de turno» (F10-CASHMOV-07) se construyen contra esta forma.
 * El dinero viaja como texto.
 */
export interface CashMovementRow {
  id: string;
  type: CashMovementTypeCode;
  reason: CashMovementReasonCode;
  amount: string;
  note: string | null;
  /** Si el alta pasó por el código de autorización del negocio. */
  authorized: boolean;
  status: "active" | "canceled";
  createdAt: string;
  createdBy: CashMovementPerson;
  canceledAt: string | null;
  canceledBy: CashMovementPerson | null;
  cancelReason: string | null;
}

const PERSONA = { select: { id: true, firstName: true, lastName: true } } as const;

/** Lo que hay que leer de un movimiento para armar su fila: quién lo registró y quién lo anuló. */
export const CASH_MOVEMENT_ROW_INCLUDE = { creator: PERSONA, canceler: PERSONA } as const;

export type CashMovementWithPeople = Prisma.CashMovementGetPayload<{
  include: typeof CASH_MOVEMENT_ROW_INCLUDE;
}>;

function persona(p: { id: string; firstName: string; lastName: string }): CashMovementPerson {
  return { id: p.id, name: shortName(p) };
}

/**
 * F10-CASHMOV-06 — la fila de un movimiento, en UN solo lugar: la arman la
 * caja (alta, anulación y lista) y el detalle de «Cierres de turno». Si cada
 * uno armara la suya, un día dirían cosas distintas del mismo retiro.
 */
export function toCashMovementRow(m: CashMovementWithPeople): CashMovementRow {
  return {
    id: m.id,
    type: m.type,
    reason: m.reason,
    amount: m.amount.toString(),
    note: m.note,
    authorized: m.authorized,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
    createdBy: persona(m.creator),
    canceledAt: m.canceledAt?.toISOString() ?? null,
    canceledBy: m.canceler === null ? null : persona(m.canceler),
    cancelReason: m.cancelReason,
  };
}

/**
 * F10-CASHMOV-06 — todos los movimientos de UN turno, con los anulados, como
 * filas. La caja los pide del más nuevo al más viejo (lo último que hizo,
 * arriba); el reporte, del más viejo al más nuevo (se lee como pasó el turno).
 */
export async function movimientosDeSesion(
  tx: Tx,
  tenantId: string,
  sessionId: string,
  orden: "asc" | "desc",
): Promise<CashMovementRow[]> {
  const filas = await tx.cashMovement.findMany({
    where: { tenantId, cashboxSessionId: sessionId },
    orderBy: [{ createdAt: orden }, { id: orden }],
    include: CASH_MOVEMENT_ROW_INCLUDE,
  });
  return filas.map(toCashMovementRow);
}
