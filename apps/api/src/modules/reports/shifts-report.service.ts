import { Injectable, NotFoundException } from "@nestjs/common";
import { endOfDayUtc, shortName, startOfDayUtc } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { assertWarehouseInScope } from "../inventory/warehouse-scope.helpers";
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
  status: string;
  warehouse: Persona;
  openedBy: Persona;
  openedAt: string;
  closedBy: Persona | null;
  closedAt: string | null;
  salesCount: number;
  totals: SessionTotal[];
  /** F9-EXP-09: los gastos en efectivo que salieron del cajón; el calculado ya los resta. */
  cashExpenses: SessionCashExpenses;
  calculatedCash: string | null;
  declaredCash: string | null;
  cashDifference: string | null;
  closingNote: string | null;
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
}

/** Una página del listado. */
export interface ShiftsReportPage {
  rows: ShiftRow[];
  total: number;
  page: number;
  pageSize: number;
}

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
      const [total, filas] = await Promise.all([
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
      ]);
      const ids = filas.map((f) => f.id);
      const [totales, gastos] = await Promise.all([
        totalesPorSesion(tx, user.tenantId, ids),
        gastosEnEfectivoPorSesion(tx, user.tenantId, ids),
      ]);
      return {
        rows: filas.map((f) =>
          this.fila(f, totales.get(f.id) ?? totalesEnCero(), gastos.get(f.id) ?? sinGastos()),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
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
      const [totales, gastos] = await Promise.all([
        totalesPorSesion(tx, user.tenantId, ids),
        gastosEnEfectivoPorSesion(tx, user.tenantId, ids),
      ]);
      return filas.map((f) =>
        this.fila(f, totales.get(f.id) ?? totalesEnCero(), gastos.get(f.id) ?? sinGastos()),
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
      const sales: ShiftSaleRow[] = fila.sales.map((v) => ({
        id: v.id,
        folio: v.folio,
        createdAt: v.createdAt.toISOString(),
        seller: nombre(v.seller),
        paymentMethod: v.paymentMethod,
        status: v.status,
        total: v.total.toString(),
      }));
      return { ...this.fila(fila, totales, gastos), sales };
    });
  }

  private fila(
    f: {
      id: string;
      status: string;
      openedAt: Date;
      closedAt: Date | null;
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
  ): ShiftRow {
    return {
      id: f.id,
      status: f.status,
      warehouse: f.warehouse,
      openedBy: nombre(f.opener),
      openedAt: f.openedAt.toISOString(),
      closedBy: f.closer === null ? null : nombre(f.closer),
      closedAt: f.closedAt?.toISOString() ?? null,
      salesCount: f._count.sales,
      totals,
      cashExpenses,
      calculatedCash: f.calculatedCash?.toString() ?? null,
      declaredCash: f.declaredCash?.toString() ?? null,
      cashDifference: f.cashDifference?.toString() ?? null,
      closingNote: f.closingNote,
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
    const abiertos = query.status === "open";
    return {
      tenantId: user.tenantId,
      status: query.status,
      ...(query.warehouseId !== undefined
        ? { warehouseId: query.warehouseId }
        : scope.warehouseIds !== "all"
          ? { warehouseId: { in: [...scope.warehouseIds] } }
          : {}),
      ...(query.userId !== undefined &&
        (abiertos ? { openedBy: query.userId } : { closedBy: query.userId })),
      ...(rango !== undefined && (abiertos ? { openedAt: rango } : { closedAt: rango })),
    };
  }
}
