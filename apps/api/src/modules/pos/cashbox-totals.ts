import { PAYMENT_METHODS, type PaymentMethod } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";

export interface SessionTotal {
  method: PaymentMethod;
  total: string;
  count: number;
}

type Tx = Pick<Prisma.TransactionClient, "sale">;

/**
 * F5-SHIFT-01 — los totales por forma de pago de uno o varios turnos, en UNA
 * consulta. Es la MISMA función para el papel del cierre
 * (`CashboxService.totals`) y para el reporte de cierres: si el reporte
 * dijera otra cosa que el papel, alguien tendría que decidir a quién creerle.
 *
 * F4-TAX-20: la caja cuenta el `total` BRUTO, con el impuesto adentro — es lo
 * que entró al cajón (decisión de Carlos, 2026-09-06). La base sin impuesto
 * vive en la utilidad y en el reporte de impuestos, no acá.
 *
 * Solo ventas `completed`: una anulada es plata que no entró. Cada turno
 * vuelve con los tres métodos, en el orden del catálogo y en cero cuando no
 * vendió con ese: la tabla siempre tiene las mismas columnas.
 */
export async function totalesPorSesion(
  tx: Tx,
  tenantId: string,
  sessionIds: readonly string[],
): Promise<Map<string, SessionTotal[]>> {
  const resultado = new Map<string, SessionTotal[]>();
  if (sessionIds.length === 0) {
    return resultado;
  }
  const filas = await tx.sale.groupBy({
    by: ["cashboxSessionId", "paymentMethod"],
    where: {
      tenantId,
      cashboxSessionId: { in: [...sessionIds] },
      status: "completed",
    },
    _sum: { total: true },
    _count: { _all: true },
  });
  for (const id of sessionIds) {
    resultado.set(
      id,
      PAYMENT_METHODS.map((method) => {
        const fila = filas.find((f) => f.cashboxSessionId === id && f.paymentMethod === method);
        return {
          method,
          total: (fila?._sum.total ?? new Prisma.Decimal(0)).toString(),
          count: fila?._count._all ?? 0,
        };
      }),
    );
  }
  return resultado;
}

/** Los tres métodos en cero: lo que devuelve un turno sin ventas. */
export function totalesEnCero(): SessionTotal[] {
  return PAYMENT_METHODS.map((method) => ({ method, total: "0", count: 0 }));
}
