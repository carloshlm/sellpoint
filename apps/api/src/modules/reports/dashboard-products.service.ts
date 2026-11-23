import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { type DashboardPeriod, resolvePeriodWindow } from "./dashboard-period";

export interface DashboardProducts {
  topSold: {
    /** Producto O servicio: los dos compiten — ambos son ventas. */
    itemId: string;
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

function margen(profit: string, revenue: string): number | null {
  const venta = new Prisma.Decimal(revenue);
  return venta.greaterThan(0)
    ? Number(new Prisma.Decimal(profit).dividedBy(venta).times(100).toDP(1).toString())
    : null;
}

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
 */
@Injectable()
export class DashboardProductsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: ClockPort,
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

    // F4-TAX-20: el revenue y la utilidad del top van sobre la BASE (line_total
    // menos el impuesto que viaja adentro): lo que el fisco se lleva no es
    // ingreso del artículo.
    const vendidos = (desde: Date, hasta: Date) =>
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<
            {
              item_id: string;
              sku: string;
              name: string;
              units: string;
              unit: string;
              revenue: string;
            }[]
          >`
          SELECT COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)) AS item_id,
                 COALESCE(p.sku, sv.code, '') AS sku,
                 COALESCE(p.name, sv.name, i.concept_description) AS name,
                 SUM(i.quantity * COALESCE(pp.factor, 1))::numeric(14,4)::text AS units,
                 COALESCE(p.base_unit, 'unit') AS unit,
                 SUM(i.line_total - i.tax_amount)::text AS revenue
            FROM sale_items i
            JOIN sales s ON s.id = i.sale_id
            LEFT JOIN products p ON p.id = i.product_id
            LEFT JOIN product_presentations pp ON pp.id = i.presentation_id
            LEFT JOIN services sv ON sv.id = i.service_id
           WHERE s.tenant_id = ${user.tenantId}::uuid
             AND s.status = 'completed'
             AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
             AND s.created_at >= ${desde} AND s.created_at < ${hasta}
           GROUP BY COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)), COALESCE(p.sku, sv.code, ''), COALESCE(p.name, sv.name, i.concept_description), COALESCE(p.base_unit, 'unit')
           ORDER BY SUM(i.line_total - i.tax_amount) DESC
           LIMIT 10`,
      );

    const [top, previos, conCosto, sinCosto] = await Promise.all([
      vendidos(ventana.desde, ventana.hasta),
      vendidos(ventana.desdeAnterior, ventana.hastaAnterior),
      // «Mayor utilidad» y «bajo costo» salen del MISMO agregado, partido por el
      // signo de la utilidad ya redondeada a centavos: así las dos listas no se
      // contradicen, y lo que quedó justo en $0.00 no está en ninguna. El
      // conteo de cada lado viaja con sus renglones (la ventana corre antes del
      // LIMIT de cinco).
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<
            {
              lado: "gain" | "loss";
              en_su_lado: number;
              item_id: string;
              kind: "product" | "service";
              sku: string;
              name: string;
              revenue: string;
              cost: string;
              profit: string;
            }[]
          >`
          WITH por_articulo AS (
            SELECT COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)) AS item_id,
                   i.kind,
                   COALESCE(p.sku, sv.code, '') AS sku,
                   COALESCE(p.name, sv.name, i.concept_description) AS name,
                   SUM(i.line_total - i.tax_amount) AS revenue,
                   SUM(i.unit_cost * i.quantity)::numeric(14,2) AS cost,
                   SUM(i.line_total - i.tax_amount - i.unit_cost * i.quantity)::numeric(14,2) AS profit
              FROM sale_items i
              JOIN sales s ON s.id = i.sale_id
              LEFT JOIN products p ON p.id = i.product_id
              LEFT JOIN services sv ON sv.id = i.service_id
             WHERE s.tenant_id = ${user.tenantId}::uuid
               AND s.status = 'completed'
               AND i.unit_cost IS NOT NULL
               AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
               AND s.created_at >= ${ventana.desde} AND s.created_at < ${ventana.hasta}
             GROUP BY COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)), i.kind, COALESCE(p.sku, sv.code, ''), COALESCE(p.name, sv.name, i.concept_description)
          ), por_lado AS (
            SELECT *,
                   CASE WHEN profit > 0 THEN 'gain' ELSE 'loss' END AS lado,
                   ROW_NUMBER() OVER (PARTITION BY profit > 0 ORDER BY abs(profit) DESC, name) AS puesto,
                   COUNT(*) OVER (PARTITION BY profit > 0)::int AS en_su_lado
              FROM por_articulo
             WHERE profit <> 0
          )
          SELECT lado, en_su_lado, item_id, kind, sku, name,
                 revenue::text AS revenue, cost::text AS cost, profit::text AS profit
            FROM por_lado
           WHERE puesto <= ${AVISOS_MAX}
           ORDER BY lado, puesto`,
      ),
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<
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
      ),
    ]);

    const ventaPrevia = new Map(previos.map((f) => [f.item_id, new Prisma.Decimal(f.revenue)]));
    const ganan = conCosto.filter((f) => f.lado === "gain");
    const pierden = conCosto.filter((f) => f.lado === "loss");

    return {
      topSold: top.map((f) => {
        const anterior = ventaPrevia.get(f.item_id);
        const actual = new Prisma.Decimal(f.revenue);
        return {
          itemId: f.item_id,
          sku: f.sku,
          name: f.name,
          units: f.units,
          unit: f.unit,
          revenue: f.revenue,
          deltaPct:
            anterior !== undefined && anterior.greaterThan(0)
              ? Number(actual.minus(anterior).dividedBy(anterior).times(100).toDP(1).toString())
              : null,
        };
      }),
      // Con utilidad mayor que cero la venta también lo es: el margen siempre existe.
      topProfit: ganan.map((f) => ({
        itemId: f.item_id,
        sku: f.sku,
        name: f.name,
        revenue: f.revenue,
        cost: f.cost,
        profit: f.profit,
        marginPct: margen(f.profit, f.revenue) ?? 0,
      })),
      belowCost: pierden.map((f) => ({
        itemId: f.item_id,
        kind: f.kind,
        sku: f.sku,
        name: f.name,
        revenue: f.revenue,
        cost: f.cost,
        profit: f.profit,
        marginPct: margen(f.profit, f.revenue),
      })),
      belowCostCount: pierden[0]?.en_su_lado ?? 0,
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
