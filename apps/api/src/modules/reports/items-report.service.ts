import { Injectable } from "@nestjs/common";
import { endOfDayUtc, startOfDayUtc } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import type { ItemsReportQueryDto, ItemsReportView } from "./dto/items-report.dto";
import {
  type ItemsRankingOrder,
  type ItemsRankingQuery,
  type ItemsRankingRow,
  ItemsRankingService,
  marginPct,
  type SoldItemKind,
} from "./items-ranking.service";

/** Un artículo del reporte, con lo que la pantalla y el Excel necesitan. */
export interface ItemsReportRow {
  kind: SoldItemKind;
  itemId: string;
  /** El código interno del producto o el del servicio; null en un concepto. */
  code: string | null;
  name: string;
  /** En la UNIDAD BASE del producto (24 piezas, 7.75 kg); servicios y conceptos se cuentan. */
  quantity: string;
  /** La unidad base del producto; null en servicios y conceptos. */
  baseUnit: string | null;
  /** Venta sin impuesto. */
  revenue: string;
  /** Null si alguna de sus ventas no tiene costo congelado: la utilidad no estaría completa. */
  cost: string | null;
  profit: string | null;
  /** En %, con un decimal; null sin utilidad o con venta en $0. */
  margin: number | null;
}

export interface ItemsReportTotals {
  revenue: string;
  cost: string | null;
  profit: string | null;
  margin: number | null;
}

export interface ItemsReportPage {
  rows: ItemsReportRow[];
  /** De TODO lo filtrado, no de la página; null si no hay nada. */
  totals: ItemsReportTotals | null;
  total: number;
  page: number;
  pageSize: number;
}

/** Qué orden —y qué líneas— lee cada vista. */
const ORDEN_DE: Record<ItemsReportView, ItemsRankingOrder> = {
  "top-sold": "revenue",
  "top-profit": "profit",
  "below-cost": "loss",
};

/** Los filtros del reporte, sin paginar: lo que comparten la pantalla y el Excel. */
export type ItemsReportFilters = Omit<ItemsReportQueryDto, "page" | "pageSize">;

/**
 * F10-RPT-03 — el reporte por artículo: «Más vendidos», «Mayor utilidad» y
 * «Vendidos bajo su costo» con los filtros de los otros reportes.
 *
 * Es la consulta del panel (`ItemsRankingService`) con filtros: mismos
 * números para el mismo periodo. Las fechas son días del calendario del
 * NEGOCIO, como en Ventas (`buildSalesWhere`): `to` incluye el día entero.
 */
@Injectable()
export class ItemsReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ranking: ItemsRankingService,
  ) {}

  async list(
    user: AuthUser,
    scope: UserScope,
    query: ItemsReportQueryDto,
  ): Promise<ItemsReportPage> {
    const consulta = await this.consulta(
      user,
      query,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    );
    const { rows, total, totals } = await this.ranking.rank(user.tenantId, scope, consulta);
    return {
      rows: rows.map(aFila),
      totals:
        totals === null
          ? null
          : {
              ...totals,
              margin: totals.profit === null ? null : marginPct(totals.profit, totals.revenue),
            },
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async count(user: AuthUser, scope: UserScope, filters: ItemsReportFilters): Promise<number> {
    return this.ranking.count(user.tenantId, scope, await this.consulta(user, filters, null, 0));
  }

  /** Todos los artículos, sin paginar: para el Excel, que ya contó (`exportWithLimit`). */
  async all(
    user: AuthUser,
    scope: UserScope,
    filters: ItemsReportFilters,
  ): Promise<ItemsReportRow[]> {
    const consulta = await this.consulta(user, filters, null, 0);
    return (await this.ranking.rank(user.tenantId, scope, consulta)).rows.map(aFila);
  }

  private async consulta(
    user: AuthUser,
    filters: ItemsReportFilters,
    limit: number | null,
    offset: number,
  ): Promise<ItemsRankingQuery> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });
    const zona = tenant?.timezone ?? "UTC";
    return {
      ...(filters.from !== undefined && { from: startOfDayUtc(filters.from, zona) }),
      // El fin de día es el ARRANQUE del siguiente: no se pierde el último milisegundo.
      ...(filters.to !== undefined && { to: endOfDayUtc(filters.to, zona) }),
      ...(filters.warehouseId !== undefined && { warehouseId: filters.warehouseId }),
      type: filters.type,
      order: ORDEN_DE[filters.view],
      limit,
      offset,
    };
  }
}

function aFila(f: ItemsRankingRow): ItemsReportRow {
  return {
    kind: f.kind,
    itemId: f.itemId,
    code: f.sku === "" ? null : f.sku,
    name: f.name,
    quantity: f.quantity,
    baseUnit: f.baseUnit,
    revenue: f.revenue,
    cost: f.cost,
    profit: f.profit,
    margin: f.profit === null ? null : marginPct(f.profit, f.revenue),
  };
}
