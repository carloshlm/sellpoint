import { Prisma } from "../../generated/prisma/client";

export interface SessionCashExpenses {
  /** Σ total de los gastos en efectivo pagados del cajón, como texto decimal. */
  total: string;
  count: number;
}

type Tx = Pick<Prisma.TransactionClient, "expense">;

/**
 * F9-EXP-09 — los gastos en EFECTIVO que salieron del cajón de uno o varios
 * turnos, en UNA consulta. El cierre los resta del efectivo esperado
 * (decisión de Carlos, 2026-09-10): si no, el arqueo acusaría al cajero de
 * un faltante que no hizo.
 *
 * ── Por qué vive aquí y no en dos lugares donde podría ─────────────────
 *
 * · NO en `ExpensesModule`: el POS lo necesita y `ExpensesModule` es un
 *   módulo de plan que el POS no debe importar (un ciclo Pos → Expenses, y
 *   el POS existe en negocios sin Gastos). Leer la TABLA con un `Pick` del
 *   TransactionClient no importa nada.
 * · NO dentro de `SessionTotal[]` (`totalesPorSesion`): esa lista alimenta la
 *   columna «Efectivo» del cierre, del reporte de turnos y del XLSX con su
 *   `count` de VENTAS. Restar ahí cambiaría el significado de «Efectivo» sin
 *   cambiar el encabezado. La resta es un renglón aparte: `expectedCash`.
 *
 * Solo gastos ACTIVOS, PAGADOS y en `cash`: un anulado ya no salió del
 * cajón; un pendiente todavía no; una transferencia nunca estuvo en él.
 */
export async function gastosEnEfectivoPorSesion(
  tx: Tx,
  tenantId: string,
  sessionIds: readonly string[],
): Promise<Map<string, SessionCashExpenses>> {
  const resultado = new Map<string, SessionCashExpenses>();
  if (sessionIds.length === 0) {
    return resultado;
  }
  const filas = await tx.expense.groupBy({
    by: ["cashboxSessionId"],
    where: {
      tenantId,
      cashboxSessionId: { in: [...sessionIds] },
      status: "active",
      paymentStatus: "paid",
      paymentMethod: "cash",
    },
    _sum: { total: true },
    _count: { _all: true },
  });
  for (const id of sessionIds) {
    const fila = filas.find((f) => f.cashboxSessionId === id);
    resultado.set(id, {
      total: (fila?._sum.total ?? new Prisma.Decimal(0)).toString(),
      count: fila?._count._all ?? 0,
    });
  }
  return resultado;
}

/** Sin gastos: lo que devuelve un turno del que no salió nada. */
export function sinGastos(): SessionCashExpenses {
  return { total: "0", count: 0 };
}

/**
 * El efectivo que DEBE haber en el cajón: el fondo con que abrió, más lo
 * vendido en efectivo, menos lo que salió.
 *
 * F10-MANFIX-10: el fondo entra aquí y en ningún otro lado. La pantalla del
 * cierre, el `calculated_cash` que se guarda y el reporte leen este número; si
 * cada uno sumara el fondo por su cuenta, un día dirían cosas distintas. Sin
 * fondo (`"0"`), la cuenta es la de F9-EXP-09 al centavo.
 *
 * Nombrados y no posicionales: son tres cadenas decimales, y cambiar dos de
 * lugar compilaría y daría un arqueo equivocado.
 */
export function efectivoEsperado(importes: {
  fondo: string;
  ventas: string;
  gastos: string;
}): string {
  return new Prisma.Decimal(importes.fondo)
    .plus(new Prisma.Decimal(importes.ventas))
    .minus(new Prisma.Decimal(importes.gastos))
    .toString();
}
