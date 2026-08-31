import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { type DashboardPeriod, resolvePeriodWindow } from "./dashboard-period";

export interface DashboardPayments {
  methods: { method: "cash" | "card" | "transfer"; total: string; pct: number }[];
}

/**
 * F5-DASH-07 — la distribución de métodos de pago del período. Los % salen
 * de la MISMA suma que los totales (jamás NaN: sin ventas, lista vacía) y la
 * lista viene ordenada de mayor a menor — el donut y la alerta del método
 * dominante la leen tal cual.
 */
@Injectable()
export class DashboardPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async paymentMethods(
    user: AuthUser,
    scope: UserScope,
    period: DashboardPeriod,
  ): Promise<DashboardPayments> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });
    const ventana = resolvePeriodWindow(period, tenant?.timezone ?? "UTC", this.clock.now());

    const grupos = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.sale.groupBy({
        by: ["paymentMethod"],
        where: {
          tenantId: user.tenantId,
          status: "completed",
          ...(scope.warehouseIds !== "all" && {
            warehouseId: { in: [...scope.warehouseIds] },
          }),
          createdAt: { gte: ventana.desde, lt: ventana.hasta },
        },
        _sum: { total: true },
      }),
    );

    const total = grupos.reduce((suma, g) => suma.plus(g._sum.total ?? 0), new Prisma.Decimal(0));
    if (!total.greaterThan(0)) {
      return { methods: [] };
    }

    return {
      methods: grupos
        .map((g) => {
          const monto = g._sum.total ?? new Prisma.Decimal(0);
          return {
            method: g.paymentMethod,
            total: monto.toString(),
            pct: Number(monto.dividedBy(total).times(100).toDP(1).toString()),
          };
        })
        .sort((a, b) => b.pct - a.pct),
    };
  }
}
