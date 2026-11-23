import { Inject, Injectable } from "@nestjs/common";
import { localCalendarDate, startOfDayUtc } from "@sellpoint/shared";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { mesAnteriorIso } from "./dashboard-period";

export interface DashboardHourPoint {
  hour: number;
  total: string;
  /**
   * F10-KPI-03 — el promedio de esa hora en el mismo día de la semana de las
   * cuatro semanas anteriores, contando solo los días que tuvieron venta.
   * `null` en las 24 horas cuando ninguno la tuvo: sin historia no hay «0».
   */
  reference: string | null;
}

export interface DashboardSeries {
  /** Día 1..31 alineado: el mes más largo manda y los huecos van en "0". */
  byDay: { day: number; current: string; previous: string }[];
  /** Las 24 horas del día local, completas — un hueco es un "0", no ausencia. */
  byHour: DashboardHourPoint[];
}

/** Cuántas semanas hacia atrás mira la referencia de la serie por hora. */
const SEMANAS_DE_REFERENCIA = 4;

/**
 * F5-DASH-04 — las dos series del panel: el mes actual contra el anterior
 * (día a día) y las ventas de HOY por hora.
 *
 * El día y la hora son LOCALES del negocio (`AT TIME ZONE` en SQL): la venta
 * de las 23:30 de CDMX cae en su día y su hora, no en los del servidor. Las
 * series salen COMPLETAS del API (1..31 y 0..23, huecos en cero): la gráfica
 * pinta lo que recibe y no adivina calendarios.
 *
 * F10-KPI-03 — cada hora trae además su referencia: un día típico al fondo
 * para que, por la mañana, una sola barra ya diga si vas bien.
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

    // Los mismos días de la semana de las cuatro semanas anteriores, como
    // fechas LOCALES (el mediodía UTC esquiva cualquier borde de horario).
    const DIA = 24 * 60 * 60 * 1000;
    const mediodiaDeHoy = new Date(`${hoy}T12:00:00Z`).getTime();
    const diasDeReferencia = Array.from({ length: SEMANAS_DE_REFERENCIA }, (_, i) =>
      new Date(mediodiaDeHoy - (i + 1) * 7 * DIA).toISOString().slice(0, 10),
    );
    const inicioReferencia = startOfDayUtc(diasDeReferencia.at(-1) ?? hoy, zona);

    const [actual, anterior, horas, referencia] = await Promise.all([
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
      // El divisor son los días que tuvieron al menos una venta completada:
      // un día cerrado no baja el promedio. Sin ninguno, no vuelve ninguna fila.
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<{ h: number; reference: string }[]>`
          WITH ventas AS (
            SELECT (s.created_at AT TIME ZONE ${zona})::date AS d,
                   EXTRACT(HOUR FROM (s.created_at AT TIME ZONE ${zona}))::int AS h,
                   s.total
              FROM sales s
             WHERE s.tenant_id = ${user.tenantId}::uuid
               AND s.status = 'completed'
               AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
               AND s.created_at >= ${inicioReferencia} AND s.created_at < ${inicioHoy}
               AND (s.created_at AT TIME ZONE ${zona})::date = ANY(${diasDeReferencia}::date[])
          )
          SELECT h,
                 ROUND(SUM(total) / (SELECT COUNT(DISTINCT d) FROM ventas), 2)::text AS reference
            FROM ventas
           GROUP BY h`,
      ),
    ]);

    const mapaActual = new Map(actual.map((f) => [f.d, f.total]));
    const mapaAnterior = new Map(anterior.map((f) => [f.d, f.total]));
    const dias = Math.max(diasDelMes(hoy.slice(0, 7)), diasDelMes(mesAnterior));
    const mapaHoras = new Map(horas.map((f) => [f.h, f.total]));
    const mapaReferencia = new Map(referencia.map((f) => [f.h, f.reference]));
    const conHistoria = referencia.length > 0;

    return {
      byDay: Array.from({ length: dias }, (_, i) => ({
        day: i + 1,
        current: mapaActual.get(i + 1) ?? "0",
        previous: mapaAnterior.get(i + 1) ?? "0",
      })),
      byHour: Array.from({ length: 24 }, (_, hour) => ({
        hour,
        total: mapaHoras.get(hour) ?? "0",
        reference: conHistoria ? (mapaReferencia.get(hour) ?? "0") : null,
      })),
    };
  }
}

/** «2026-03» → 31. El truco del día 0: el día cero del mes siguiente. */
function diasDelMes(yyyyMm: string): number {
  const [y, m] = yyyyMm.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, m ?? 1, 0)).getUTCDate();
}
