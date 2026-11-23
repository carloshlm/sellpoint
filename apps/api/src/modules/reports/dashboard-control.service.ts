import { Inject, Injectable } from "@nestjs/common";
import { localCalendarDate } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { type DashboardPeriod, resolvePeriodWindow } from "./dashboard-period";

/** Un lado del arqueo: cuánto y en cuántos turnos. */
export interface DashboardControlCashSide {
  amount: string;
  shifts: number;
}

export interface DashboardControlCash {
  shortage: DashboardControlCashSide;
  overage: DashboardControlCashSide;
  closedShifts: number;
}

export interface DashboardControlDiscounts {
  amount: string;
  tickets: number;
  /** Descuento ÷ (cobrado + descuento), con un decimal; null sin ventas cobradas. */
  pctOfSales: number | null;
}

export interface DashboardControlCancellations {
  count: number;
  amount: string;
}

/** Las fechas del periodo en el calendario del negocio (`YYYY-MM-DD`), para enlazar los reportes. */
export interface DashboardControlRange {
  from: string;
  to: string;
}

export interface DashboardControl {
  cash: DashboardControlCash;
  discounts: DashboardControlDiscounts;
  cancellations: DashboardControlCancellations;
  range: DashboardControlRange;
}

const dinero = (valor: Prisma.Decimal | null | undefined) =>
  (valor ?? new Prisma.Decimal(0)).toFixed(2);

/**
 * F10-KPI-14 — «Control»: dónde se va el dinero en el periodo de las pestañas.
 *
 * - **Caja:** los turnos CERRADOS con `closedAt` en el periodo. Los faltantes y
 *   los sobrantes se suman por separado y los dos en positivo: un faltante de
 *   200 y un sobrante de 200 no son «cero», son dos cosas que revisar.
 * - **Descuentos:** las ventas cobradas del periodo (por su fecha) con
 *   descuento. El porcentaje es sobre lo que se habría cobrado sin él.
 * - **Cancelaciones:** las ventas con `canceledAt` en el periodo, sin importar
 *   cuándo se vendieron: se cancela HOY lo que se cancela hoy.
 *
 * Todo dentro de UNA transacción: el panel ya abre varias por carga y el pool
 * es de diez conexiones. Las consultas van en secuencia sobre el mismo `tx`.
 *
 * No lee `user.userId`: el expediente del backoffice llega con un actor
 * sintético (`admin/platform-actor.ts`) cuyo usuario no es de este negocio.
 */
@Injectable()
export class DashboardControlService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async control(
    user: AuthUser,
    scope: UserScope,
    period: DashboardPeriod,
  ): Promise<DashboardControl> {
    const { tenantId } = user;
    const ahora = this.clock.now();

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const zona = tenant?.timezone ?? "UTC";
      const ventana = resolvePeriodWindow(period, zona, ahora);
      const rango = { gte: ventana.desde, lt: ventana.hasta };
      const alcance =
        scope.warehouseIds === "all" ? {} : { warehouseId: { in: [...scope.warehouseIds] } };

      const cerrados = { tenantId, ...alcance, status: "closed" as const, closedAt: rango };
      const faltantes = await tx.cashboxSession.aggregate({
        where: { ...cerrados, cashDifference: { lt: 0 } },
        _sum: { cashDifference: true },
        _count: { _all: true },
      });
      const sobrantes = await tx.cashboxSession.aggregate({
        where: { ...cerrados, cashDifference: { gt: 0 } },
        _sum: { cashDifference: true },
        _count: { _all: true },
      });
      const turnosCerrados = await tx.cashboxSession.count({ where: cerrados });

      const cobradas = { tenantId, ...alcance, status: "completed" as const, createdAt: rango };
      const cobrado = await tx.sale.aggregate({
        where: cobradas,
        _sum: { total: true },
        _count: { _all: true },
      });
      const conDescuento = await tx.sale.aggregate({
        where: { ...cobradas, discount: { gt: 0 } },
        _sum: { discount: true },
        _count: { _all: true },
      });
      const canceladas = await tx.sale.aggregate({
        where: { tenantId, ...alcance, status: "canceled", canceledAt: rango },
        _sum: { total: true },
        _count: { _all: true },
      });

      const descuento = conDescuento._sum.discount ?? new Prisma.Decimal(0);
      const sinDescuento = (cobrado._sum.total ?? new Prisma.Decimal(0)).plus(descuento);
      const pctOfSales =
        cobrado._count._all > 0 && sinDescuento.greaterThan(0)
          ? Number(descuento.dividedBy(sinDescuento).times(100).toDP(1).toString())
          : null;

      return {
        cash: {
          shortage: {
            amount: dinero(faltantes._sum.cashDifference?.abs()),
            shifts: faltantes._count._all,
          },
          overage: {
            amount: dinero(sobrantes._sum.cashDifference),
            shifts: sobrantes._count._all,
          },
          closedShifts: turnosCerrados,
        },
        discounts: {
          amount: dinero(descuento),
          tickets: conDescuento._count._all,
          pctOfSales,
        },
        cancellations: {
          count: canceladas._count._all,
          amount: dinero(canceladas._sum.total),
        },
        range: rangoLocal(ventana.desde, ventana.hasta, zona),
      };
    });
  }
}

/**
 * La ventana `[desde, hasta)` en días del negocio: el último día es el del
 * instante anterior a `hasta` (el mes anterior termina el 28 o el 31, no el 1).
 */
function rangoLocal(desde: Date, hasta: Date, zona: string): DashboardControlRange {
  const from = localCalendarDate(zona, desde);
  if (hasta.getTime() <= desde.getTime()) {
    return { from, to: from };
  }
  return { from, to: localCalendarDate(zona, new Date(hasta.getTime() - 1)) };
}
