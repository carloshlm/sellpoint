import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { assertWarehouseInScope } from "../inventory/warehouse-scope.helpers";

/** Qué es cada artículo vendido: el ícono del panel y del reporte sale de aquí. */
export type SoldItemKind = "product" | "service" | "concept";

/**
 * El orden, que también decide QUÉ líneas cuentan:
 *  · `revenue` — todo lo cobrado, por venta sin impuesto y luego por cantidad.
 *  · `profit` — solo líneas con costo congelado y solo lo que DEJÓ (utilidad
 *    mayor que cero), de la mayor utilidad a la menor.
 *  · `loss` — solo líneas con costo y solo lo que PERDIÓ (utilidad menor que
 *    cero), de la mayor pérdida a la menor.
 *
 * Lo que quedó justo en $0.00 no está ni en `profit` ni en `loss` (F10-KPI-01).
 */
export type ItemsRankingOrder = "revenue" | "profit" | "loss";

/**
 * `product` es todo lo que NO es servicio: los productos y los conceptos
 * libres, como en «Ventas por producto» (`SalesLinesReportService`), para que
 * los dos reportes sumen lo mismo del mismo periodo.
 */
export type ItemsRankingType = "all" | "product" | "service";

export interface ItemsRankingQuery {
  /** Instante inicial, incluido. Sin él, el rango queda abierto hacia atrás. */
  from?: Date;
  /** Instante final, EXCLUIDO. Sin él, el rango queda abierto hacia adelante. */
  to?: Date;
  /** Una sucursal; fuera del alcance responde 403, no una lista vacía. */
  warehouseId?: string;
  type: ItemsRankingType;
  order: ItemsRankingOrder;
  /** Cuántos renglones; null trae todos (el Excel, que ya contó primero). */
  limit: number | null;
  offset: number;
}

export interface ItemsRankingRow {
  /** El id del producto o del servicio; un concepto, `concept:` y su descripción. */
  itemId: string;
  kind: SoldItemKind;
  /** El código interno del producto o el del servicio; vacío en un concepto. */
  sku: string;
  name: string;
  /**
   * Cuánto se vendió en la UNIDAD BASE del producto: la venta guarda lo que se
   * tecleó en su presentación (2 × «Caja ×12») y aquí se multiplica por el
   * factor (24 piezas). Servicios y conceptos se cuentan.
   */
  quantity: string;
  /** La unidad base del producto (`kg`, `unit`…); null en servicios y conceptos. */
  baseUnit: string | null;
  /** Venta sin impuesto: lo que el fisco se lleva no es ingreso (F4-TAX-20). */
  revenue: string;
  /**
   * Null si alguna de sus líneas se vendió sin costo congelado: una utilidad a
   * medias no es la utilidad. En `profit` y `loss` nunca es null, porque esas
   * vistas solo leen líneas con costo.
   */
  cost: string | null;
  profit: string | null;
}

export interface ItemsRankingTotals {
  revenue: string;
  /** Null si algún artículo de lo filtrado no tiene costo completo. */
  cost: string | null;
  profit: string | null;
}

export interface ItemsRanking {
  rows: ItemsRankingRow[];
  /** Cuántos artículos hay en TODO lo filtrado, no en la página. */
  total: number;
  /** El pie de TODO lo filtrado; null si no hay nada. */
  totals: ItemsRankingTotals | null;
}

/** El margen en %, con un decimal; null si la venta no es mayor que cero. */
export function marginPct(profit: string, revenue: string): number | null {
  const venta = new Prisma.Decimal(revenue);
  return venta.greaterThan(0)
    ? Number(new Prisma.Decimal(profit).dividedBy(venta).times(100).toDP(1).toString())
    : null;
}

interface FilaLeida {
  total: number;
  total_revenue: string | null;
  total_cost: string | null;
  total_profit: string | null;
  item_id: string | null;
  kind: SoldItemKind;
  sku: string;
  name: string;
  quantity: string;
  base_unit: string | null;
  revenue: string;
  cost: string | null;
  profit: string | null;
}

const LADO: Record<ItemsRankingOrder, Prisma.Sql> = {
  revenue: Prisma.empty,
  profit: Prisma.sql`WHERE profit > 0`,
  loss: Prisma.sql`WHERE profit < 0`,
};

// El `item_id` al final desempata dos artículos con el mismo nombre: así un
// renglón no sale en dos páginas.
const ORDEN: Record<ItemsRankingOrder, Prisma.Sql> = {
  revenue: Prisma.sql`revenue DESC, quantity DESC, name, item_id`,
  profit: Prisma.sql`profit DESC, name, item_id`,
  loss: Prisma.sql`profit ASC, name, item_id`,
};

const TIPO: Record<ItemsRankingType, Prisma.Sql> = {
  all: Prisma.empty,
  product: Prisma.sql`AND i.kind <> 'service'`,
  service: Prisma.sql`AND i.kind = 'service'`,
};

/**
 * F10-RPT-03 — la consulta por artículo, UNA sola para el panel y el reporte.
 *
 * Nació en el panel (`DashboardProductsService`, F5-DASH-05 y F10-KPI-01) y
 * se extrajo aquí cuando «Más vendidos», «Mayor utilidad» y «Vendidos bajo su
 * costo» se volvieron reportes con filtros: si el reporte calculara por su
 * lado, los dos dirían números distintos del mismo periodo.
 *
 * Lee solo ventas COBRADAS. La utilidad de cada línea es
 * `line_total − tax_amount − unit_cost × quantity`: `line_total` ya trae su
 * descuento y su parte del descuento del ticket, y el impuesto que viaja
 * adentro no es ingreso. El costo y la utilidad se redondean a centavos
 * DESPUÉS de sumar, como siempre los dio el panel.
 *
 * Una sola ida a la base: el resumen (conteo y pie) sale del mismo agregado
 * que la página, así que el pie suma exactamente lo que la tabla lista, y una
 * página más allá del final conserva su conteo.
 */
@Injectable()
export class ItemsRankingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `tx` es una transacción PRESTADA, ya abierta con `withTenantContext` del
   * MISMO `tenantId`: el panel hace sus consultas en fila dentro de una sola,
   * en vez de pedir una conexión por consulta (Sentry SELLPOINT-API-7). Sin
   * ella, abre la suya.
   */
  async rank(
    tenantId: string,
    scope: UserScope,
    query: ItemsRankingQuery,
    tx?: Prisma.TransactionClient,
  ): Promise<ItemsRanking> {
    if (query.warehouseId !== undefined) {
      // 403 y no una lista vacía: «esa sucursal no vendió nada» sería mentira.
      assertWarehouseInScope(scope, query.warehouseId);
    }
    const almacenes = scope.warehouseIds === "all" ? null : [...scope.warehouseIds];
    const soloConCosto =
      query.order === "revenue" ? Prisma.empty : Prisma.sql`AND i.unit_cost IS NOT NULL`;
    const desde =
      query.from === undefined ? Prisma.empty : Prisma.sql`AND s.created_at >= ${query.from}`;
    const hasta =
      query.to === undefined ? Prisma.empty : Prisma.sql`AND s.created_at < ${query.to}`;
    const sucursal =
      query.warehouseId === undefined
        ? Prisma.empty
        : Prisma.sql`AND s.warehouse_id = ${query.warehouseId}::uuid`;
    const limite = query.limit === null ? Prisma.empty : Prisma.sql`LIMIT ${query.limit}`;
    const orden = ORDEN[query.order];

    const consulta = (cliente: Prisma.TransactionClient) =>
      cliente.$queryRaw<FilaLeida[]>`
        WITH por_articulo AS (
          SELECT COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)) AS item_id,
                 i.kind,
                 COALESCE(p.sku, sv.code, '') AS sku,
                 COALESCE(p.name, sv.name, i.concept_description) AS name,
                 p.base_unit,
                 SUM(i.quantity * COALESCE(pp.factor, 1))::numeric(14,4) AS quantity,
                 SUM(i.line_total - i.tax_amount) AS revenue,
                 (CASE WHEN COUNT(i.unit_cost) = COUNT(*) THEN SUM(i.unit_cost * i.quantity) END)::numeric(14,2) AS cost,
                 (CASE WHEN COUNT(i.unit_cost) = COUNT(*) THEN SUM(i.line_total - i.tax_amount - i.unit_cost * i.quantity) END)::numeric(14,2) AS profit
            FROM sale_items i
            JOIN sales s ON s.id = i.sale_id
            LEFT JOIN products p ON p.id = i.product_id
            LEFT JOIN product_presentations pp ON pp.id = i.presentation_id
            LEFT JOIN services sv ON sv.id = i.service_id
           WHERE s.tenant_id = ${tenantId}::uuid
             AND s.status = 'completed'
             AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
             ${soloConCosto}
             ${sucursal}
             ${TIPO[query.type]}
             ${desde}
             ${hasta}
           GROUP BY COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)), i.kind, COALESCE(p.sku, sv.code, ''), COALESCE(p.name, sv.name, i.concept_description), p.base_unit
        ), elegidos AS (
          SELECT * FROM por_articulo ${LADO[query.order]}
        ), pagina AS (
          SELECT *, ROW_NUMBER() OVER (ORDER BY ${orden}) AS puesto
            FROM elegidos
           ORDER BY ${orden}
           ${limite} OFFSET ${query.offset}
        ), resumen AS (
          SELECT COUNT(*)::int AS total,
                 SUM(revenue)::text AS total_revenue,
                 (CASE WHEN COUNT(cost) = COUNT(*) THEN SUM(cost) END)::text AS total_cost,
                 (CASE WHEN COUNT(profit) = COUNT(*) THEN SUM(profit) END)::text AS total_profit
            FROM elegidos
        )
        SELECT r.total, r.total_revenue, r.total_cost, r.total_profit,
               pg.item_id, pg.kind, pg.sku, pg.name, pg.quantity::text AS quantity, pg.base_unit,
               pg.revenue::text AS revenue, pg.cost::text AS cost, pg.profit::text AS profit
          FROM resumen r
          LEFT JOIN pagina pg ON true
         ORDER BY pg.puesto`;
    const filas =
      tx === undefined
        ? await this.prisma.withTenantContext(tenantId, consulta)
        : await consulta(tx);

    // El resumen viaja en TODOS los renglones (y en uno vacío si la página no trae nada).
    const resumen = filas[0];
    const total = resumen?.total ?? 0;
    return {
      rows: filas.flatMap((f) =>
        f.item_id === null
          ? []
          : [
              {
                itemId: f.item_id,
                kind: f.kind,
                sku: f.sku,
                name: f.name,
                quantity: f.quantity,
                baseUnit: f.base_unit,
                revenue: f.revenue,
                cost: f.cost,
                profit: f.profit,
              },
            ],
      ),
      total,
      totals:
        total === 0 || resumen === undefined
          ? null
          : {
              revenue: resumen.total_revenue ?? "0.00",
              cost: resumen.total_cost,
              profit: resumen.total_profit,
            },
    };
  }

  /** Cuántos artículos deja el filtro, sin traer ninguno: el `count` del Excel. */
  async count(tenantId: string, scope: UserScope, query: ItemsRankingQuery): Promise<number> {
    return (await this.rank(tenantId, scope, { ...query, limit: 0, offset: 0 })).total;
  }
}
