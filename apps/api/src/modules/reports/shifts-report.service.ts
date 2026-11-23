import { Injectable, NotFoundException } from "@nestjs/common";
import { endOfDayUtc, shortName, startOfDayUtc } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { assertWarehouseInScope } from "../inventory/warehouse-scope.helpers";
import {
  type CashMovementRow,
  movimientosDeSesion,
  movimientosPorSesion,
  type SessionCashMovements,
  sinMovimientos,
} from "../pos/cash-movements";
import {
  gastosEnEfectivoPorSesion,
  type SessionCashExpenses,
  sinGastos,
} from "../pos/cashbox-expenses";
import { type SessionTotal, totalesEnCero, totalesPorSesion } from "../pos/cashbox-totals";
import type { ShiftsReportQueryDto } from "./dto/shifts-report.dto";

interface Persona {
  id: string;
  name: string;
}

export interface ShiftRow {
  id: string;
  /** `TUR-000001`: el folio que el turno tomó al abrir (Carlos, 2026-11-16). */
  folio: string;
  status: string;
  warehouse: Persona;
  openedBy: Persona;
  openedAt: string;
  closedBy: Persona | null;
  closedAt: string | null;
  salesCount: number;
  totals: SessionTotal[];
  /** F10-MANFIX-10: el fondo con que abrió el turno («0» sin fondo); el calculado ya lo suma. */
  openingCash: string;
  /** F9-EXP-09: los gastos en efectivo que salieron del cajón; el calculado ya los resta. */
  cashExpenses: SessionCashExpenses;
  calculatedCash: string | null;
  declaredCash: string | null;
  cashDifference: string | null;
  closingNote: string | null;
  /**
   * F10-CASHMOV-06: Σ de las entradas de efectivo ACTIVAS del turno («0» sin
   * entradas); el calculado ya las suma. Al final: un web anterior la ignora.
   */
  cashIn: string;
  /** F10-CASHMOV-06: Σ de los retiros de efectivo ACTIVOS del turno («0» sin retiros); el calculado ya los resta. */
  cashOut: string;
}

export interface ShiftSaleRow {
  id: string;
  folio: string;
  createdAt: string;
  seller: Persona;
  paymentMethod: string;
  status: string;
  total: string;
}

/** El turno con sus ventas: lo que devuelve `GET /reports/shifts/:id`. */
export interface ShiftDetail extends ShiftRow {
  sales: ShiftSaleRow[];
  /**
   * F10-CASHMOV-06: las entradas y los retiros del turno, del más viejo al más
   * nuevo, con los anulados. La MISMA fila que la caja (`CashMovementRow`).
   */
  movements: CashMovementRow[];
}

/** Una página del listado. */
export interface ShiftsReportPage {
  rows: ShiftRow[];
  total: number;
  page: number;
  pageSize: number;
  /**
   * F10-KPI-13 — cuánto FALTÓ y cuánto SOBRÓ en los cierres de todo el
   * periodo filtrado (no de la página), los dos en positivo y con dos
   * decimales. Por separado: un faltante nunca se compensa con un sobrante.
   */
  differenceTotals: { shortage: string; overage: string };
}

type Diferencia = NonNullable<ShiftsReportQueryDto["difference"]>;

/** Qué cierres deja cada valor del filtro «Diferencia». */
const POR_DIFERENCIA: Record<Diferencia, Prisma.DecimalNullableFilter> = {
  shortage: { lt: 0 },
  overage: { gt: 0 },
  balanced: { equals: 0 },
};

/** La suma de las diferencias, en positivo; sin ninguna, «0.00» (un cero real). */
const enPositivo = (suma: Prisma.Decimal | null): string =>
  suma === null ? "0.00" : suma.abs().toFixed(2);

const nombre = (u: { id: string; firstName: string; lastName: string }): Persona => ({
  id: u.id,
  name: shortName(u),
});

const PERSONA = { select: { id: true, firstName: true, lastName: true } } as const;

/**
 * F5-SHIFT — el reporte de cierres de turno: una LECTURA de
 * `cashbox_sessions` ⋈ `sales`. El dato lo escribió el cierre (F4-CASHBOX:
 * declarado, calculado, diferencia y nota); aquí no se recalcula nada, y los
 * totales por forma de pago salen de la misma función que el papel.
 *
 * Mismo alcance que Ventas: `UserScope` SIEMPRE viaja, y pedir un almacén
 * fuera de él es 403, no una lista vacía.
 */
@Injectable()
export class ShiftsReportService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: AuthUser,
    scope: UserScope,
    query: ShiftsReportQueryDto,
  ): Promise<ShiftsReportPage> {
    const where = await this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      // F10-KPI-13: el pie suma cada lado por su cuenta, sobre el periodo
      // filtrado entero. `AND` para no pisar lo que el `where` ya diga.
      const sumaDe = (lado: Prisma.DecimalNullableFilter) =>
        tx.cashboxSession.aggregate({
          where: { AND: [where, { status: "closed", cashDifference: lado }] },
          _sum: { cashDifference: true },
        });
      const [total, filas, faltantes, sobrantes] = await Promise.all([
        tx.cashboxSession.count({ where }),
        tx.cashboxSession.findMany({
          where,
          // El cierre manda el orden; los abiertos, su apertura. Desempate por id.
          orderBy:
            query.status === "open"
              ? [{ openedAt: "desc" }, { id: "desc" }]
              : [{ closedAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            warehouse: { select: { id: true, name: true } },
            opener: PERSONA,
            closer: PERSONA,
            _count: { select: { sales: true } },
          },
        }),
        sumaDe(POR_DIFERENCIA.shortage),
        sumaDe(POR_DIFERENCIA.overage),
      ]);
      const ids = filas.map((f) => f.id);
      // F10-CASHMOV-06: los movimientos de la página, en UNA consulta como los gastos.
      const [totales, gastos, movimientos] = await Promise.all([
        totalesPorSesion(tx, user.tenantId, ids),
        gastosEnEfectivoPorSesion(tx, user.tenantId, ids),
        movimientosPorSesion(tx, user.tenantId, ids),
      ]);
      return {
        rows: filas.map((f) =>
          this.fila(
            f,
            totales.get(f.id) ?? totalesEnCero(),
            gastos.get(f.id) ?? sinGastos(),
            movimientos.get(f.id) ?? sinMovimientos(),
          ),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
        differenceTotals: {
          shortage: enPositivo(faltantes._sum.cashDifference),
          overage: enPositivo(sobrantes._sum.cashDifference),
        },
      };
    });
  }

  /** Todas las filas del filtro, para el export (el tope lo pone quien llama). */
  async all(user: AuthUser, scope: UserScope, query: ShiftsReportQueryDto): Promise<ShiftRow[]> {
    const where = await this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const filas = await tx.cashboxSession.findMany({
        where,
        orderBy:
          query.status === "open"
            ? [{ openedAt: "desc" }, { id: "desc" }]
            : [{ closedAt: "desc" }, { id: "desc" }],
        include: {
          warehouse: { select: { id: true, name: true } },
          opener: PERSONA,
          closer: PERSONA,
          _count: { select: { sales: true } },
        },
      });
      const ids = filas.map((f) => f.id);
      // F10-CASHMOV-06: los movimientos de la página, en UNA consulta como los gastos.
      const [totales, gastos, movimientos] = await Promise.all([
        totalesPorSesion(tx, user.tenantId, ids),
        gastosEnEfectivoPorSesion(tx, user.tenantId, ids),
        movimientosPorSesion(tx, user.tenantId, ids),
      ]);
      return filas.map((f) =>
        this.fila(
          f,
          totales.get(f.id) ?? totalesEnCero(),
          gastos.get(f.id) ?? sinGastos(),
          movimientos.get(f.id) ?? sinMovimientos(),
        ),
      );
    });
  }

  async count(user: AuthUser, scope: UserScope, query: ShiftsReportQueryDto): Promise<number> {
    const where = await this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, (tx) => tx.cashboxSession.count({ where }));
  }

  /** F5-SHIFT-02 — un turno con sus ventas. Fuera del alcance es 404, igual que inexistente. */
  async detail(user: AuthUser, scope: UserScope, id: string): Promise<ShiftDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const fila = await tx.cashboxSession.findFirst({
        where: {
          id,
          tenantId: user.tenantId,
          ...(scope.warehouseIds !== "all" && { warehouseId: { in: [...scope.warehouseIds] } }),
        },
        include: {
          warehouse: { select: { id: true, name: true } },
          opener: PERSONA,
          closer: PERSONA,
          _count: { select: { sales: true } },
          sales: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: { seller: PERSONA },
          },
        },
      });
      if (fila === null) {
        throw new NotFoundException({ message: "reports.shift_not_found" });
      }
      const totales = (await totalesPorSesion(tx, user.tenantId, [id])).get(id) ?? totalesEnCero();
      const gastos =
        (await gastosEnEfectivoPorSesion(tx, user.tenantId, [id])).get(id) ?? sinGastos();
      const sumas =
        (await movimientosPorSesion(tx, user.tenantId, [id])).get(id) ?? sinMovimientos();
      // Del más viejo al más nuevo: el detalle se lee como pasó el turno.
      const movements = await movimientosDeSesion(tx, user.tenantId, id, "asc");
      const sales: ShiftSaleRow[] = fila.sales.map((v) => ({
        id: v.id,
        folio: v.folio,
        createdAt: v.createdAt.toISOString(),
        seller: nombre(v.seller),
        paymentMethod: v.paymentMethod,
        status: v.status,
        total: v.total.toString(),
      }));
      return { ...this.fila(fila, totales, gastos, sumas), sales, movements };
    });
  }

  private fila(
    f: {
      id: string;
      folio: string;
      status: string;
      openedAt: Date;
      closedAt: Date | null;
      openingCash: Prisma.Decimal;
      declaredCash: Prisma.Decimal | null;
      calculatedCash: Prisma.Decimal | null;
      cashDifference: Prisma.Decimal | null;
      closingNote: string | null;
      warehouse: Persona;
      opener: { id: string; firstName: string; lastName: string };
      closer: { id: string; firstName: string; lastName: string } | null;
      _count: { sales: number };
    },
    totals: SessionTotal[],
    cashExpenses: SessionCashExpenses,
    movimientos: SessionCashMovements,
  ): ShiftRow {
    return {
      id: f.id,
      folio: f.folio,
      status: f.status,
      warehouse: f.warehouse,
      openedBy: nombre(f.opener),
      openedAt: f.openedAt.toISOString(),
      closedBy: f.closer === null ? null : nombre(f.closer),
      closedAt: f.closedAt?.toISOString() ?? null,
      salesCount: f._count.sales,
      totals,
      openingCash: f.openingCash.toString(),
      cashExpenses,
      calculatedCash: f.calculatedCash?.toString() ?? null,
      declaredCash: f.declaredCash?.toString() ?? null,
      cashDifference: f.cashDifference?.toString() ?? null,
      closingNote: f.closingNote,
      cashIn: movimientos.cashIn,
      cashOut: movimientos.cashOut,
    };
  }

  /** La zona del negocio: el rango de fechas y el export la necesitan. */
  async timeZone(user: AuthUser): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? "UTC";
  }

  private async where(
    user: AuthUser,
    scope: UserScope,
    query: ShiftsReportQueryDto,
  ): Promise<Prisma.CashboxSessionWhereInput> {
    if (query.warehouseId !== undefined) {
      assertWarehouseInScope(scope, query.warehouseId);
    }
    const timeZone = await this.timeZone(user);
    // El rango va sobre el CIERRE (sobre la apertura en los abiertos), en días
    // del calendario del negocio: un cierre a las 23:30 en CDMX es de ese día.
    const rango =
      query.from !== undefined || query.to !== undefined
        ? {
            ...(query.from !== undefined && { gte: startOfDayUtc(query.from, timeZone) }),
            ...(query.to !== undefined && { lt: endOfDayUtc(query.to, timeZone) }),
          }
        : undefined;
    // Sin estado se listan los cerrados; buscando un folio, los dos: quien
    // tiene el folio en la mano no sabe si ese turno ya cerró.
    const estado = query.status ?? (query.search === undefined ? "closed" : undefined);
    // El empleado y el rango dependen del estado: en un abierto cuentan quién
    // lo abrió y cuándo; en un cerrado, quién lo cerró y cuándo. Buscando en
    // los dos, cada uno con su regla (verificación, 2026-11-16: con «Empleado»
    // elegido, el turno abierto de esa persona desaparecía de la búsqueda).
    const porEstado = (st: "open" | "closed"): Prisma.CashboxSessionWhereInput => ({
      status: st,
      ...(query.userId !== undefined &&
        (st === "open" ? { openedBy: query.userId } : { closedBy: query.userId })),
      ...(rango !== undefined && (st === "open" ? { openedAt: rango } : { closedAt: rango })),
    });
    const base: Prisma.CashboxSessionWhereInput = {
      tenantId: user.tenantId,
      ...(estado !== undefined
        ? porEstado(estado)
        : { OR: [porEstado("open"), porEstado("closed")] }),
      ...(query.warehouseId !== undefined
        ? { warehouseId: query.warehouseId }
        : scope.warehouseIds !== "all"
          ? { warehouseId: { in: [...scope.warehouseIds] } }
          : {}),
      // Por folio, completo («TUR-000042») o por su número («42»): lo que la
      // persona tenga a la mano. Contiene y sin mayúsculas, como el buscador
      // de ventas.
      ...(query.search !== undefined && {
        folio: { contains: query.search, mode: "insensitive" as const },
      }),
    };
    // F10-KPI-13 — la diferencia es de un CIERRE: el filtro deja solo
    // cerrados, también buscando por folio (que trae abiertos y cerrados) o
    // con «Abiertos» (que entonces no trae nada). `AND` para no pisar el
    // estado ni el `OR` de arriba.
    return query.difference === undefined
      ? base
      : {
          AND: [base, { status: "closed", cashDifference: POR_DIFERENCIA[query.difference] }],
        };
  }
}
