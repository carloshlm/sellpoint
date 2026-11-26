import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { type DashboardPeriod, resolvePeriodWindow } from "./dashboard-period";
import {
  type ItemsRankingQuery,
  ItemsRankingService,
  marginPct,
  type SoldItemKind,
} from "./items-ranking.service";

export interface DashboardProducts {
  topSold: {
    /** Producto O servicio: los dos compiten — ambos son ventas. */
    itemId: string;
    /** F10-RPT-01: de él sale el ícono del renglón. */
    kind: SoldItemKind;
    sku: string;
    name: string;
    /**
     * Cuánto se vendió, en la UNIDAD BASE del producto: la venta guarda lo que
     * el cajero tecleó en su presentación (2 × «Caja ×12», 31 × «Porción 250 g»)
     * y aquí se convierte con el factor — 24 piezas, 7.75 kg.
     */
    units: string;
    /** Código de esa unidad (`kg`, `l`, `unit`…). Servicios y conceptos se cuentan: `unit`. */
    unit: string;
    revenue: string;
    /** Δ% de la venta vs el período comparable; null sin historia previa. */
    deltaPct: number | null;
  }[];
  /** Lo que más DEJÓ: solo utilidad mayor que cero (F10-KPI-01). */
  topProfit: {
    itemId: string;
    /** F10-RPT-01: de él sale el ícono del renglón. */
    kind: SoldItemKind;
    sku: string;
    name: string;
    revenue: string;
    cost: string;
    profit: string;
    marginPct: number;
  }[];
  /**
   * F10-KPI-01 — lo vendido por DEBAJO de su costo en el periodo, de la mayor
   * pérdida a la menor (hasta 5). Una pérdida no es un «top»: es una noticia.
   */
  belowCost: {
    itemId: string;
    kind: "product" | "service";
    sku: string;
    name: string;
    revenue: string;
    cost: string;
    profit: string;
    /** null si se vendió en $0 (un regalo): ahí el margen no existe. */
    marginPct: number | null;
  }[];
  /** Cuántos se vendieron bajo costo en total, aunque la lista traiga 5. */
  belowCostCount: number;
  /**
   * F10-KPI-01 — productos y servicios vendidos SIN costo congelado, por importe
   * (hasta 5): esas ventas no cuentan en la utilidad. El importe es solo el de
   * las líneas sin costo. Un concepto libre no entra: no tiene ficha donde
   * capturarle uno.
   */
  uncosted: {
    itemId: string;
    kind: "product" | "service";
    sku: string;
    name: string;
    revenue: string;
  }[];
  uncostedCount: number;
}

/** Hasta cuántos renglones trae cada lista de avisos. */
const AVISOS_MAX = 5;

/** Cuántos trae «Más vendidos». */
const VENDIDOS_MAX = 10;

/**
 * F5-DASH-05 — los tops: qué se VENDE y qué DEJA.
 *
 * «Más vendidos» se ordena por IMPORTE, no por cantidad (F5-DASH-18, Carlos
 * 2026-09-21): 253 fotocopias de $2 no venden más que 5.3 kg de queso de $540,
 * y piezas contra kilos ni siquiera se pueden comparar — el dinero sí. La
 * cantidad, con su unidad, acompaña a cada renglón como dato.
 *
 * Son dos listas a propósito: vender mucho no es ganar mucho, y el top de
 * utilidad —solo líneas con costo congelado (F5-DASH-01)— es donde el
 * dashboard deja de ser caja registradora. La Δ% de cada producto contra el
 * período comparable alimenta la alerta «Producto X creció 32%».
 *
 * F10-RPT-03: «Más vendidos», «Mayor utilidad» y «bajo costo» salen de la
 * consulta por artículo compartida con el reporte (`ItemsRankingService`):
 * el panel y el reporte dicen los mismos números del mismo periodo.
 */
@Injectable()
export class DashboardProductsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly ranking: ItemsRankingService,
  ) {}

  async products(
    user: AuthUser,
    scope: UserScope,
    period: DashboardPeriod,
  ): Promise<DashboardProducts> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });
    const ventana = resolvePeriodWindow(period, tenant?.timezone ?? "UTC", this.clock.now());
    const almacenes = scope.warehouseIds === "all" ? null : [...scope.warehouseIds];
    // Sentry SELLPOINT-API-7 (2026-11-25): las cinco consultas van en fila
    // dentro de UNA transacción. Con un `Promise.all` de cinco transacciones,
    // una carga del Panel pedía cinco conexiones solo para esta sección y,
    // junto con las demás, agotaba el pool: «Unable to start a transaction».
    const { top, previos, ganan, pierden, sinCosto } = await this.prisma.withTenantContext(
      user.tenantId,
      async (tx) => {
        const ranking = (consulta: Pick<ItemsRankingQuery, "from" | "to" | "order" | "limit">) =>
          this.ranking.rank(user.tenantId, scope, { ...consulta, type: "all", offset: 0 }, tx);

        // F4-TAX-20: el revenue y la utilidad del top van sobre la BASE
        // (line_total menos el impuesto que viaja adentro): lo que el fisco se
        // lleva no es ingreso del artículo.
        const vendidos = (from: Date, to: Date) =>
          ranking({ from, to, order: "revenue", limit: VENDIDOS_MAX });

        return {
          top: await vendidos(ventana.desde, ventana.hasta),
          previos: await vendidos(ventana.desdeAnterior, ventana.hastaAnterior),
          // «Mayor utilidad» y «bajo costo» salen del MISMO agregado, partido
          // por el signo de la utilidad ya redondeada a centavos: así las dos
          // listas no se contradicen, y lo que quedó justo en $0.00 no está en
          // ninguna. El conteo de las pérdidas es de TODAS, aunque la lista
          // traiga cinco.
          ganan: await ranking({
            from: ventana.desde,
            to: ventana.hasta,
            order: "profit",
            limit: AVISOS_MAX,
          }),
          pierden: await ranking({
            from: ventana.desde,
            to: ventana.hasta,
            order: "loss",
            limit: AVISOS_MAX,
          }),
          sinCosto: await tx.$queryRaw<
            {
              total: number;
              item_id: string;
              kind: "product" | "service";
              sku: string;
              name: string;
              revenue: string;
            }[]
          >`
          SELECT COALESCE(i.product_id::text, i.service_id::text) AS item_id,
                 i.kind,
                 COALESCE(p.sku, sv.code, '') AS sku,
                 COALESCE(p.name, sv.name) AS name,
                 SUM(i.line_total - i.tax_amount)::text AS revenue,
                 COUNT(*) OVER ()::int AS total
            FROM sale_items i
            JOIN sales s ON s.id = i.sale_id
            LEFT JOIN products p ON p.id = i.product_id
            LEFT JOIN services sv ON sv.id = i.service_id
           WHERE s.tenant_id = ${user.tenantId}::uuid
             AND s.status = 'completed'
             AND i.unit_cost IS NULL
             AND i.kind <> 'concept'
             AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
             AND s.created_at >= ${ventana.desde} AND s.created_at < ${ventana.hasta}
           GROUP BY COALESCE(i.product_id::text, i.service_id::text), i.kind, COALESCE(p.sku, sv.code, ''), COALESCE(p.name, sv.name)
           ORDER BY SUM(i.line_total - i.tax_amount) DESC, COALESCE(p.name, sv.name)
           LIMIT ${AVISOS_MAX}`,
        };
      },
    );

    const ventaPrevia = new Map(previos.rows.map((f) => [f.itemId, new Prisma.Decimal(f.revenue)]));

    return {
      topSold: top.rows.map((f) => {
        const anterior = ventaPrevia.get(f.itemId);
        const actual = new Prisma.Decimal(f.revenue);
        return {
          itemId: f.itemId,
          kind: f.kind,
          sku: f.sku,
          name: f.name,
          units: f.quantity,
          // Servicios y conceptos se cuentan: `unit`.
          unit: f.baseUnit ?? "unit",
          revenue: f.revenue,
          deltaPct:
            anterior !== undefined && anterior.greaterThan(0)
              ? Number(actual.minus(anterior).dividedBy(anterior).times(100).toDP(1).toString())
              : null,
        };
      }),
      // Con utilidad mayor que cero la venta también lo es: el margen siempre
      // existe. En estas dos vistas el costo y la utilidad nunca son null:
      // solo leen líneas con costo.
      topProfit: ganan.rows.map((f) => ({
        itemId: f.itemId,
        kind: f.kind,
        sku: f.sku,
        name: f.name,
        revenue: f.revenue,
        cost: f.cost ?? "0.00",
        profit: f.profit ?? "0.00",
        marginPct: marginPct(f.profit ?? "0", f.revenue) ?? 0,
      })),
      // Un concepto nunca tiene costo: en una pérdida solo hay productos y servicios.
      belowCost: pierden.rows.map((f) => ({
        itemId: f.itemId,
        kind: f.kind as "product" | "service",
        sku: f.sku,
        name: f.name,
        revenue: f.revenue,
        cost: f.cost ?? "0.00",
        profit: f.profit ?? "0.00",
        marginPct: marginPct(f.profit ?? "0", f.revenue),
      })),
      belowCostCount: pierden.total,
      uncosted: sinCosto.map((f) => ({
        itemId: f.item_id,
        kind: f.kind,
        sku: f.sku,
        name: f.name,
        revenue: f.revenue,
      })),
      uncostedCount: sinCosto[0]?.total ?? 0,
    };
  }
}
