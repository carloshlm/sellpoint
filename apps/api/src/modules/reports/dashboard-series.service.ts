import { Inject, Injectable } from "@nestjs/common";
import { localCalendarDate, startOfDayUtc } from "@sellpoint/shared";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { mesAnteriorIso } from "./dashboard-period";

export interface DashboardSeries {
  /** Día 1..31 alineado: el mes más largo manda y los huecos van en "0". */
  byDay: { day: number; current: string; previous: string }[];
  /** Las 24 horas del día local, completas — un hueco es un "0", no ausencia. */
  byHour: { hour: number; total: string }[];
}

/**
 * F5-DASH-04 — las dos series del panel: el mes actual contra el anterior
 * (día a día) y las ventas de HOY por hora.
 *
 * El día y la hora son LOCALES del negocio (`AT TIME ZONE` en SQL): la venta
 * de las 23:30 de CDMX cae en su día y su hora, no en los del servidor. Las
 * series salen COMPLETAS del API (1..31 y 0..23, huecos en cero): la gráfica
 * pinta lo que recibe y no adivina calendarios.
 */
@Injectable()
export class DashboardSeriesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async series(user: AuthUser, scope: UserScope): Promise<DashboardSeries> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });
    const zona = tenant?.timezone ?? "UTC";
    const ahora = this.clock.now();
    const hoy = localCalendarDate(zona, ahora);

    const inicioMes = startOfDayUtc(`${hoy.slice(0, 7)}-01`, zona);
    const mesAnterior = mesAnteriorIso(hoy);
    const inicioMesAnterior = startOfDayUtc(`${mesAnterior}-01`, zona);
    const inicioHoy = startOfDayUtc(hoy, zona);

    const almacenes = scope.warehouseIds === "all" ? null : [...scope.warehouseIds];

    const porDia = (desde: Date, hasta: Date) =>
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<{ d: number; total: string }[]>`
          SELECT EXTRACT(DAY FROM (s.created_at AT TIME ZONE ${zona}))::int AS d,
                 SUM(s.total)::text AS total
            FROM sales s
           WHERE s.tenant_id = ${user.tenantId}::uuid
             AND s.status = 'completed'
             AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
             AND s.created_at >= ${desde} AND s.created_at < ${hasta}
           GROUP BY d`,
      );

    const [actual, anterior, horas] = await Promise.all([
      porDia(inicioMes, ahora),
      porDia(inicioMesAnterior, inicioMes),
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<{ h: number; total: string }[]>`
          SELECT EXTRACT(HOUR FROM (s.created_at AT TIME ZONE ${zona}))::int AS h,
                 SUM(s.total)::text AS total
            FROM sales s
           WHERE s.tenant_id = ${user.tenantId}::uuid
             AND s.status = 'completed'
             AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
             AND s.created_at >= ${inicioHoy} AND s.created_at < ${ahora}
           GROUP BY h`,
      ),
    ]);

    const mapaActual = new Map(actual.map((f) => [f.d, f.total]));
    const mapaAnterior = new Map(anterior.map((f) => [f.d, f.total]));
    const dias = Math.max(diasDelMes(hoy.slice(0, 7)), diasDelMes(mesAnterior));
    const mapaHoras = new Map(horas.map((f) => [f.h, f.total]));

    return {
      byDay: Array.from({ length: dias }, (_, i) => ({
        day: i + 1,
        current: mapaActual.get(i + 1) ?? "0",
        previous: mapaAnterior.get(i + 1) ?? "0",
      })),
      byHour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        total: mapaHoras.get(hour) ?? "0",
      })),
    };
  }
}

/** «2026-03» → 31. El truco del día 0: el día cero del mes siguiente. */
function diasDelMes(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
}
