import { Inject, Injectable } from "@nestjs/common";
import { localCalendarDate, startOfDayUtc } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";

/**
 * F10-KPI-06 — el punto de equilibrio del mes: cuánto de los gastos ya cubrió
 * la utilidad. Se dice como avance y no como pérdida: a medio mes la neta sale
 * negativa por construcción (la renta entra completa con su fecha y las ventas
 * se acumulan día a día).
 */
export interface DashboardBreakEven {
  /** Los gastos del mes: el MISMO total que resta `netMonth`. */
  expenses: string;
  /** Utilidad ÷ gastos, con un decimal; null sin utilidad o sin gastos. */
  coveredPct: number | null;
  /** Día local desde el que la utilidad acumulada cubre los gastos; null si todavía no. */
  coveredOnDay: number | null;
  /**
   * Lo que falta vender (en pesos cobrados) para cubrirlos, al ritmo de lo que
   * dejó cada peso cobrado en los últimos 30 días; null si ya se cubrió o si
   * no hay con qué estimar.
   */
  remainingSales: string | null;
}

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
    /**
     * F10-KPI-05 — el cierre estimado: lo vendido en los días CERRADOS más su
     * promedio diario por los días que faltan, contando hoy. No se mueve
     * durante el día; null con menos de tres días cerrados.
     */
    projected: string | null;
    /** F10-KPI-05 — lo que falta para la meta ÷ los días que quedan, contando hoy; "0.00" si ya se alcanzó y null sin meta. */
    requiredDaily: string | null;
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
    /**
     * F9-EXP-11 — la utilidad NETA: la bruta menos los gastos ACTIVOS del mes
     * (por `expense_date`, día del negocio) en el alcance. null cuando la
     * bruta es null: sin costos no hay utilidad que netear, aunque haya gastos.
     * El front la pinta solo con el módulo de Gastos.
     */
    netMonth: string | null;
    netDeltaVsPrevMonthPct: number | null;
    /**
     * F10-KPI-05 — utilidad ÷ el precio sin impuesto de las MISMAS líneas con
     * costo, con un decimal; null si la utilidad es null.
     */
    marginPct: number | null;
    breakEven: DashboardBreakEven;
  };
}

/** Lo que dejaron las líneas con costo congelado de un período. */
interface LineasConCosto {
  /** Σ(base − costo); null si ninguna línea del período tiene costo. */
  utilidad: Prisma.Decimal | null;
  /** Σ(line_total − tax_amount): el precio sin impuesto, la base del margen. */
  base: Prisma.Decimal | null;
  /** Σ line_total: lo cobrado, impuesto incluido. */
  cobrado: Prisma.Decimal | null;
}

/** Mínimo de días cerrados para estimar el cierre (decisión de Carlos, 2026-11-23). */
const DIAS_CERRADOS_MINIMOS = 3;

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

    // F10-KPI-06: el ritmo de «cada peso cobrado» sale de hoy y los 29 días
    // anteriores, días del negocio.
    const inicioUltimos30 = startOfDayUtc(sumarDias(hoy, -29), zona);

    const alcance =
      scope.warehouseIds === "all" ? {} : { warehouseId: { in: [...scope.warehouseIds] } };
    const base = { tenantId: user.tenantId, status: "completed" as const, ...alcance };

    /**
     * F10-KPI-05 — el instante de la primera venta completada del alcance (null
     * si nunca ha vendido): un negocio que empezó el día 10 no tiene días
     * cerrados del 1 al 9 que le bajen el promedio.
     */
    const primeraVenta = async () => {
      const agregado = await this.prisma.withTenantContext(user.tenantId, (tx) =>
        tx.sale.aggregate({
          where: { ...base, createdAt: { lt: ahora } },
          _min: { createdAt: true },
        }),
      );
      return agregado._min.createdAt;
    };

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

    const [
      diaHoy,
      diaPasado,
      mesActual,
      mesPasado,
      conCostoMes,
      conCostoMesPasado,
      gastos,
      gastosPasados,
      conCostoUltimos30,
      utilidadPorDia,
      primera,
    ] = await Promise.all([
      suma(inicioHoy, ahora),
      suma(inicioMismoDiaPasado, haceUnaSemana),
      suma(inicioMes, ahora),
      suma(inicioMesAnterior, corteMesAnterior),
      this.lineasConCosto(user.tenantId, alcance, inicioMes, ahora),
      this.lineasConCosto(user.tenantId, alcance, inicioMesAnterior, corteMesAnterior),
      // Los gastos van por DÍA del negocio (DATE con DATE): el corte corrido
      // se traduce a los días locales de los dos instantes.
      this.gastosDelMes(
        user.tenantId,
        alcance,
        localCalendarDate(zona, inicioMes),
        localCalendarDate(zona, ahora),
      ),
      this.gastosDelMes(
        user.tenantId,
        alcance,
        localCalendarDate(zona, inicioMesAnterior),
        localCalendarDate(zona, corteMesAnterior),
      ),
      this.lineasConCosto(user.tenantId, alcance, inicioUltimos30, ahora),
      this.utilidadPorDia(user.tenantId, alcance, zona, inicioMes, ahora),
      primeraVenta(),
    ]);
    const utilidad = conCostoMes.utilidad;
    const utilidadPasada = conCostoMesPasado.utilidad;
    const neta = utilidad === null ? null : utilidad.minus(gastos);
    const netaPasada = utilidadPasada === null ? null : utilidadPasada.minus(gastosPasados);

    const goal = tenant?.monthlySalesGoal ?? null;
    const diaDelMes = Number(hoy.slice(8, 10));
    // Los días que faltan, CONTANDO hoy: el 15 de marzo quedan 17 (del 15 al 31).
    const diasQueQuedan = diasDelMes(hoy) - diaDelMes + 1;
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
        projected: cierreEstimado({
          zona,
          hoy,
          primeraVenta: primera,
          // Lo de los días cerrados es el mes menos hoy: antes de la primera
          // venta no hay ventas que restar.
          cerrado: mesActual.total.minus(diaHoy.total),
          diasQueQuedan,
        }),
        requiredDaily: goal?.greaterThan(0)
          ? Prisma.Decimal.max(goal.minus(mesActual.total), 0).dividedBy(diasQueQuedan).toFixed(2)
          : null,
      },
      profit: {
        month: utilidad?.toString() ?? null,
        deltaVsPrevMonthPct:
          utilidad !== null && utilidadPasada !== null ? deltaPct(utilidad, utilidadPasada) : null,
        netMonth: neta?.toString() ?? null,
        netDeltaVsPrevMonthPct:
          neta !== null && netaPasada !== null ? deltaPct(neta, netaPasada) : null,
        marginPct:
          utilidad !== null && conCostoMes.base?.greaterThan(0)
            ? redondear(utilidad.dividedBy(conCostoMes.base).times(100))
            : null,
        breakEven: puntoDeEquilibrio(utilidad, gastos, utilidadPorDia, conCostoUltimos30),
      },
    };
  }

  /**
   * F9-EXP-11 — Σ total de los gastos ACTIVOS entre dos días del negocio
   * (inclusive, `expense_date` es DATE y se compara con DATE — nunca con un
   * instante UTC: un gasto del día 1 a las 20:00 de CDMX es del día 1), en
   * los almacenes del alcance. SUM sobre cero filas es NULL: acá sí vale 0,
   * porque «no gastó nada» es un número, no un hueco.
   */
  private async gastosDelMes(
    tenantId: string,
    alcance: { warehouseId?: { in: string[] } },
    desdeDia: string,
    hastaDia: string,
  ): Promise<Prisma.Decimal> {
    const agregado = await this.prisma.withTenantContext(tenantId, (tx) =>
      tx.expense.aggregate({
        where: {
          tenantId,
          status: "active",
          ...alcance,
          expenseDate: { gte: new Date(desdeDia), lte: new Date(hastaDia) },
        },
        _sum: { total: true },
      }),
    );
    return agregado._sum.total ?? new Prisma.Decimal(0);
  }

  /**
   * Σ(lineTotal − unitCost × quantity) del mes, SOLO en líneas con snapshot.
   * SUM sobre cero filas es NULL en SQL — y así llega al front: «aún no hay
   * datos de costo» no es «utilidad cero». La resta usa lineTotal (que ya
   * netea el descuento de línea), así el descuento no infla el margen.
   */
  /**
   * F4-TAX-20: la utilidad va sobre la BASE — el impuesto que viaja dentro
   * del `line_total` no es ingreso del negocio, se lo lleva el fisco. Los KPIs
   * de venta, la meta y la caja siguen en bruto (Carlos, 2026-09-06): son lo
   * que entró a la caja. Y `unit_cost` es NETO por construcción (F9-COSTMODE-08):
   * la venta desimpuesta el catálogo al congelar si el negocio captura «con
   * impuesto», así que precio y costo se restan en la MISMA base.
   *
   * F10-KPI-05/06: la misma consulta trae también la base (el precio sin
   * impuesto, divisor del margen) y lo cobrado (con impuesto, divisor de «lo
   * que deja cada peso cobrado»), siempre de las MISMAS líneas con costo.
   */
  private async lineasConCosto(
    tenantId: string,
    alcance: { warehouseId?: { in: string[] } },
    desde: Date,
    hasta: Date,
  ): Promise<LineasConCosto> {
    const almacenes = alcance.warehouseId?.in;
    type Fila = { profit: string | null; base: string | null; charged: string | null };
    const filas = await this.prisma.withTenantContext(tenantId, (tx) =>
      almacenes === undefined
        ? tx.$queryRaw<Fila[]>`
            SELECT SUM(i.line_total - i.tax_amount - i.unit_cost * i.quantity)::text AS profit,
                   SUM(i.line_total - i.tax_amount)::text AS base,
                   SUM(i.line_total)::text AS charged
              FROM sale_items i
              JOIN sales s ON s.id = i.sale_id
             WHERE s.tenant_id = ${tenantId}::uuid
               AND s.status = 'completed'
               AND s.created_at >= ${desde} AND s.created_at < ${hasta}
               AND i.unit_cost IS NOT NULL`
        : tx.$queryRaw<Fila[]>`
            SELECT SUM(i.line_total - i.tax_amount - i.unit_cost * i.quantity)::text AS profit,
                   SUM(i.line_total - i.tax_amount)::text AS base,
                   SUM(i.line_total)::text AS charged
              FROM sale_items i
              JOIN sales s ON s.id = i.sale_id
             WHERE s.tenant_id = ${tenantId}::uuid
               AND s.status = 'completed'
               AND s.warehouse_id = ANY(${almacenes}::uuid[])
               AND s.created_at >= ${desde} AND s.created_at < ${hasta}
               AND i.unit_cost IS NOT NULL`,
    );
    const decimal = (crudo: string | null | undefined) =>
      crudo === null || crudo === undefined ? null : new Prisma.Decimal(crudo);
    return {
      utilidad: decimal(filas[0]?.profit),
      base: decimal(filas[0]?.base),
      cobrado: decimal(filas[0]?.charged),
    };
  }

  /**
   * F10-KPI-06 — la utilidad de cada día LOCAL del período (mismas líneas con
   * costo que `lineasConCosto`), en orden: con ella se encuentra el día en que
   * la acumulada alcanzó los gastos. Un día sin líneas con costo no aparece.
   */
  private async utilidadPorDia(
    tenantId: string,
    alcance: { warehouseId?: { in: string[] } },
    zona: string,
    desde: Date,
    hasta: Date,
  ): Promise<{ dia: number; utilidad: Prisma.Decimal }[]> {
    const almacenes = alcance.warehouseId?.in ?? null;
    const filas = await this.prisma.withTenantContext(
      tenantId,
      (tx) =>
        tx.$queryRaw<{ dia: number; profit: string }[]>`
        SELECT EXTRACT(DAY FROM (s.created_at AT TIME ZONE ${zona}))::int AS dia,
               SUM(i.line_total - i.tax_amount - i.unit_cost * i.quantity)::text AS profit
          FROM sale_items i
          JOIN sales s ON s.id = i.sale_id
         WHERE s.tenant_id = ${tenantId}::uuid
           AND s.status = 'completed'
           AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
           AND s.created_at >= ${desde} AND s.created_at < ${hasta}
           AND i.unit_cost IS NOT NULL
         GROUP BY dia
         ORDER BY dia`,
    );
    return filas.map((fila) => ({ dia: fila.dia, utilidad: new Prisma.Decimal(fila.profit) }));
  }
}

/**
 * F10-KPI-05 — el cierre estimado del mes. Usa solo días CERRADOS (del 1 a
 * ayer, o desde el día de la primera venta si fue este mes): así no se mueve
 * durante el día ni castiga los días en que el negocio no existía. Calla
 * (null) con menos de tres días cerrados o si nunca ha vendido.
 */
function cierreEstimado(datos: {
  zona: string;
  hoy: string;
  primeraVenta: Date | null;
  cerrado: Prisma.Decimal;
  diasQueQuedan: number;
}): string | null {
  if (datos.primeraVenta === null) {
    return null;
  }
  const diaPrimera = localCalendarDate(datos.zona, datos.primeraVenta);
  const desdeDia =
    diaPrimera.slice(0, 7) === datos.hoy.slice(0, 7) ? Number(diaPrimera.slice(8)) : 1;
  const diasCerrados = Number(datos.hoy.slice(8, 10)) - desdeDia;
  if (diasCerrados < DIAS_CERRADOS_MINIMOS) {
    return null;
  }
  // cerrado + (cerrado ÷ díasCerrados) × díasQueQuedan, con una sola división.
  return datos.cerrado
    .times(diasCerrados + datos.diasQueQuedan)
    .dividedBy(diasCerrados)
    .toFixed(2);
}

/**
 * F10-KPI-06 — el punto de equilibrio. Sin utilidad (no hay costos) o sin
 * gastos no hay avance que medir: null, nunca 100%.
 */
function puntoDeEquilibrio(
  utilidad: Prisma.Decimal | null,
  gastos: Prisma.Decimal,
  porDia: { dia: number; utilidad: Prisma.Decimal }[],
  ultimos30: LineasConCosto,
): DashboardBreakEven {
  const expenses = gastos.toFixed(2);
  if (utilidad === null || !gastos.greaterThan(0)) {
    return { expenses, coveredPct: null, coveredOnDay: null, remainingSales: null };
  }
  const coveredPct = redondear(utilidad.dividedBy(gastos).times(100));
  const falta = gastos.minus(utilidad);
  if (!falta.greaterThan(0)) {
    return {
      expenses,
      coveredPct,
      coveredOnDay: diaDeCobertura(porDia, gastos),
      remainingSales: null,
    };
  }
  // Lo que falta, al ritmo de lo que dejó cada peso cobrado en los últimos 30
  // días: falta ÷ (utilidad30 ÷ cobrado30). Si cada peso no deja nada (o
  // pierde), vender más no cubre nada: no hay con qué estimar.
  const { utilidad: utilidad30, cobrado: cobrado30 } = ultimos30;
  const remainingSales =
    utilidad30?.greaterThan(0) && cobrado30?.greaterThan(0)
      ? falta.times(cobrado30).dividedBy(utilidad30).toFixed(2)
      : null;
  return { expenses, coveredPct, coveredOnDay: null, remainingSales };
}

/**
 * El día desde el que la utilidad acumulada cubre los gastos y ya no los
 * destapa: si una pérdida la regresa por debajo, cuenta el nuevo cruce. Así
 * «Gastos cubiertos desde el día X» es verdad cualquier día después de X.
 */
function diaDeCobertura(
  porDia: { dia: number; utilidad: Prisma.Decimal }[],
  gastos: Prisma.Decimal,
): number | null {
  let acumulada = new Prisma.Decimal(0);
  let desde: number | null = null;
  for (const { dia, utilidad } of porDia) {
    acumulada = acumulada.plus(utilidad);
    if (acumulada.lessThan(gastos)) {
      desde = null;
    } else if (desde === null) {
      desde = dia;
    }
  }
  return desde;
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

/** «2026-03-15» + (−29) → «2026-02-14»: aritmética de calendario, sin horas. */
function sumarDias(iso: string, dias: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + dias))
    .toISOString()
    .slice(0, 10);
}

/** Los días del mes de esa fecha: «2026-03-15» → 31, «2026-02-10» → 28. */
function diasDelMes(iso: string): number {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
}

/** «2026-03-15» → «2026-02»; enero retrocede de año. */
function mesAnteriorIso(hoyIso: string): string {
  const [year, month] = hoyIso.split("-").map(Number);
  const y = (month ?? 1) === 1 ? (year ?? 1970) - 1 : (year ?? 1970);
  const m = (month ?? 1) === 1 ? 12 : (month ?? 1) - 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}
