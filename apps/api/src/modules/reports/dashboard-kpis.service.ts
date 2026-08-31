import { Inject, Injectable } from "@nestjs/common";
import { localCalendarDate, startOfDayUtc } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";

/** Los cuatro números de arriba del dashboard (F5-DASH-03). */
export interface DashboardKpis {
  today: {
    total: string;
    tickets: number;
    /** null sin tickets: «no hay promedio» no es «promedio cero». */
    averageTicket: string | null;
    /** Δ% vs el mismo día de la semana pasada, a misma hora corrida. */
    deltaVsLastWeekPct: number | null;
  };
  month: {
    total: string;
    /** Δ% vs el mes anterior a mismo día corrido. */
    deltaVsPrevMonthPct: number | null;
    goal: string | null;
    goalPct: number | null;
  };
  profit: {
    /** null cuando NINGUNA línea del mes tiene costo congelado (F5-DASH-01). */
    month: string | null;
    /**
     * Δ% vs la utilidad del mes anterior a mismo día corrido — la misma ley
     * que ventas. null sin base previa (el snapshot nació el 2026-08-31: la
     * primera delta madura un mes después, y eso es un dato, no un hueco).
     */
    deltaVsPrevMonthPct: number | null;
  };
}

/**
 * F5-DASH-03 — el corazón numérico del dashboard.
 *
 * Tres reglas gobiernan todo cálculo de acá:
 *
 * 1. **El día y el mes son LOCALES del negocio** (tenant.timezone, vía los
 *    helpers de shared): una venta a las 23:30 de CDMX es de ese día aunque
 *    su instante UTC diga el siguiente.
 * 2. **Toda comparación es a mismo tiempo CORRIDO.** Hoy a las 10am se
 *    compara contra el mismo día de la semana pasada HASTA las 10am, y el
 *    mes contra el anterior hasta el mismo día y hora. Comparar un período
 *    parcial contra uno completo diría «vas 60% abajo» cada mañana — un
 *    número que asusta sin informar.
 * 3. **null nunca es 0.** Sin período anterior no hay delta; sin tickets no
 *    hay promedio; sin costos congelados no hay utilidad. El front distingue
 *    «aún no sé» de «cero pesos» porque son historias distintas.
 *
 * El «ahora» viene de ClockPort (f1-auth §6): toda la matemática es relativa
 * a él y con reloj inyectado los bordes se fijan en tests de una vez.
 */
@Injectable()
export class DashboardKpisService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async kpis(user: AuthUser, scope: UserScope): Promise<DashboardKpis> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true, monthlySalesGoal: true },
    });
    const zona = tenant?.timezone ?? "UTC";
    const ahora = this.clock.now();

    const hoy = localCalendarDate(zona, ahora);
    const inicioHoy = startOfDayUtc(hoy, zona);
    const haceUnaSemana = new Date(ahora.getTime() - 7 * 24 * 60 * 60 * 1000);
    const inicioMismoDiaPasado = startOfDayUtc(localCalendarDate(zona, haceUnaSemana), zona);

    const inicioMes = startOfDayUtc(`${hoy.slice(0, 7)}-01`, zona);
    const mesAnterior = mesAnteriorIso(hoy);
    const inicioMesAnterior = startOfDayUtc(`${mesAnterior}-01`, zona);
    // El corte corrido del mes anterior: mismo tiempo transcurrido. Si el mes
    // anterior fue más corto (31 de marzo vs febrero), el corte se pasa de su
    // fin y el clamp lo deja en el mes COMPLETO — no hay días de dónde sacar.
    const transcurrido = ahora.getTime() - inicioMes.getTime();
    const corteMesAnterior = new Date(
      Math.min(inicioMesAnterior.getTime() + transcurrido, inicioMes.getTime()),
    );

    const alcance =
      scope.warehouseIds === "all" ? {} : { warehouseId: { in: [...scope.warehouseIds] } };
    const base = { tenantId: user.tenantId, status: "completed" as const, ...alcance };

    const suma = async (desde: Date, hasta: Date) => {
      const agregado = await this.prisma.withTenantContext(user.tenantId, (tx) =>
        tx.sale.aggregate({
          where: { ...base, createdAt: { gte: desde, lt: hasta } },
          _sum: { total: true },
          _count: true,
        }),
      );
      return {
        total: agregado._sum.total ?? new Prisma.Decimal(0),
        tickets: agregado._count,
      };
    };

    const [diaHoy, diaPasado, mesActual, mesPasado, utilidad, utilidadPasada] = await Promise.all([
      suma(inicioHoy, ahora),
      suma(inicioMismoDiaPasado, haceUnaSemana),
      suma(inicioMes, ahora),
      suma(inicioMesAnterior, corteMesAnterior),
      this.utilidadDelMes(user.tenantId, alcance, inicioMes, ahora),
      this.utilidadDelMes(user.tenantId, alcance, inicioMesAnterior, corteMesAnterior),
    ]);

    const goal = tenant?.monthlySalesGoal ?? null;
    return {
      today: {
        total: diaHoy.total.toString(),
        tickets: diaHoy.tickets,
        averageTicket:
          diaHoy.tickets > 0 ? diaHoy.total.dividedBy(diaHoy.tickets).toDP(2).toString() : null,
        deltaVsLastWeekPct: deltaPct(diaHoy.total, diaPasado.total),
      },
      month: {
        total: mesActual.total.toString(),
        deltaVsPrevMonthPct: deltaPct(mesActual.total, mesPasado.total),
        goal: goal?.toString() ?? null,
        goalPct: goal?.greaterThan(0)
          ? redondear(mesActual.total.dividedBy(goal).times(100))
          : null,
      },
      profit: {
        month: utilidad?.toString() ?? null,
        deltaVsPrevMonthPct:
          utilidad !== null && utilidadPasada !== null ? deltaPct(utilidad, utilidadPasada) : null,
      },
    };
  }

  /**
   * Σ(lineTotal − unitCost × quantity) del mes, SOLO en líneas con snapshot.
   * SUM sobre cero filas es NULL en SQL — y así llega al front: «aún no hay
   * datos de costo» no es «utilidad cero». La resta usa lineTotal (que ya
   * netea el descuento de línea), así el descuento no infla el margen.
   */
  private async utilidadDelMes(
    tenantId: string,
    alcance: { warehouseId?: { in: string[] } },
    desde: Date,
    hasta: Date,
  ): Promise<Prisma.Decimal | null> {
    const almacenes = alcance.warehouseId?.in;
    const filas = await this.prisma.withTenantContext(tenantId, (tx) =>
      almacenes === undefined
        ? tx.$queryRaw<{ profit: string | null }[]>`
            SELECT SUM(i.line_total - i.unit_cost * i.quantity)::text AS profit
              FROM sale_items i
              JOIN sales s ON s.id = i.sale_id
             WHERE s.tenant_id = ${tenantId}::uuid
               AND s.status = 'completed'
               AND s.created_at >= ${desde} AND s.created_at < ${hasta}
               AND i.unit_cost IS NOT NULL`
        : tx.$queryRaw<{ profit: string | null }[]>`
            SELECT SUM(i.line_total - i.unit_cost * i.quantity)::text AS profit
              FROM sale_items i
              JOIN sales s ON s.id = i.sale_id
             WHERE s.tenant_id = ${tenantId}::uuid
               AND s.status = 'completed'
               AND s.warehouse_id = ANY(${almacenes}::uuid[])
               AND s.created_at >= ${desde} AND s.created_at < ${hasta}
               AND i.unit_cost IS NOT NULL`,
    );
    const crudo = filas[0]?.profit ?? null;
    return crudo === null ? null : new Prisma.Decimal(crudo);
  }
}

/** Δ% redondeado a 1 decimal; null cuando el período anterior quedó en 0. */
function deltaPct(actual: Prisma.Decimal, anterior: Prisma.Decimal): number | null {
  if (!anterior.greaterThan(0)) {
    return null;
  }
  return redondear(actual.minus(anterior).dividedBy(anterior).times(100));
}

function redondear(valor: Prisma.Decimal): number {
  return Number(valor.toDP(1).toString());
}

/** «2026-03-15» → «2026-02»; enero retrocede de año. */
function mesAnteriorIso(hoyIso: string): string {
  const [year, month] = hoyIso.split("-").map(Number);
  const y = (month ?? 1) === 1 ? (year ?? 1970) - 1 : (year ?? 1970);
  const m = (month ?? 1) === 1 ? 12 : (month ?? 1) - 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
