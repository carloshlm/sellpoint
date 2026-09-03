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
    units: string;
    revenue: string;
    /** Δ% de la venta vs el período comparable; null sin historia previa. */
    deltaPct: number | null;
  }[];
  topProfit: {
    itemId: string;
    sku: string;
    name: string;
    revenue: string;
    cost: string;
    profit: string;
    marginPct: number;
  }[];
}

/**
 * F5-DASH-05 — los tops: qué se VENDE y qué DEJA.
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

    const vendidos = (desde: Date, hasta: Date) =>
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<
            { item_id: string; sku: string; name: string; units: string; revenue: string }[]
          >`
          SELECT COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)) AS item_id,
                 COALESCE(p.sku, sv.code, '') AS sku,
                 COALESCE(p.name, sv.name, i.concept_description) AS name,
                 SUM(i.quantity)::text AS units,
                 SUM(i.line_total)::text AS revenue
            FROM sale_items i
            JOIN sales s ON s.id = i.sale_id
            LEFT JOIN products p ON p.id = i.product_id
            LEFT JOIN services sv ON sv.id = i.service_id
           WHERE s.tenant_id = ${user.tenantId}::uuid
             AND s.status = 'completed'
             AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
             AND s.created_at >= ${desde} AND s.created_at < ${hasta}
           GROUP BY COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)), COALESCE(p.sku, sv.code, ''), COALESCE(p.name, sv.name, i.concept_description)
           ORDER BY SUM(i.quantity) DESC
           LIMIT 10`,
      );

    const [top, previos, utilidad] = await Promise.all([
      vendidos(ventana.desde, ventana.hasta),
      vendidos(ventana.desdeAnterior, ventana.hastaAnterior),
      this.prisma.withTenantContext(
        user.tenantId,
        (tx) =>
          tx.$queryRaw<
            {
              item_id: string;
              sku: string;
              name: string;
              revenue: string;
              cost: string;
              profit: string;
            }[]
          >`
          SELECT COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)) AS item_id,
                 COALESCE(p.sku, sv.code, '') AS sku,
                 COALESCE(p.name, sv.name, i.concept_description) AS name,
                 SUM(i.line_total)::text AS revenue,
                 SUM(i.unit_cost * i.quantity)::numeric(14,2)::text AS cost,
                 SUM(i.line_total - i.unit_cost * i.quantity)::numeric(14,2)::text AS profit
            FROM sale_items i
            JOIN sales s ON s.id = i.sale_id
            LEFT JOIN products p ON p.id = i.product_id
            LEFT JOIN services sv ON sv.id = i.service_id
           WHERE s.tenant_id = ${user.tenantId}::uuid
             AND s.status = 'completed'
             AND i.unit_cost IS NOT NULL
             AND (${almacenes}::uuid[] IS NULL OR s.warehouse_id = ANY(${almacenes}::uuid[]))
             AND s.created_at >= ${ventana.desde} AND s.created_at < ${ventana.hasta}
           GROUP BY COALESCE(i.product_id::text, i.service_id::text, 'concept:' || lower(i.concept_description)), COALESCE(p.sku, sv.code, ''), COALESCE(p.name, sv.name, i.concept_description)
           ORDER BY SUM(i.line_total - i.unit_cost * i.quantity) DESC
           LIMIT 5`,
      ),
    ]);

    const ventaPrevia = new Map(previos.map((f) => [f.item_id, new Prisma.Decimal(f.revenue)]));

    return {
      topSold: top.map((f) => {
        const anterior = ventaPrevia.get(f.item_id);
        const actual = new Prisma.Decimal(f.revenue);
        return {
          itemId: f.item_id,
          sku: f.sku,
          name: f.name,
          units: f.units,
          revenue: f.revenue,
          deltaPct:
            anterior !== undefined && anterior.greaterThan(0)
              ? Number(actual.minus(anterior).dividedBy(anterior).times(100).toDP(1).toString())
              : null,
        };
      }),
      topProfit: utilidad.map((f) => {
        const revenue = new Prisma.Decimal(f.revenue);
        return {
          itemId: f.item_id,
          sku: f.sku,
          name: f.name,
          revenue: f.revenue,
          cost: f.cost,
          profit: f.profit,
          marginPct: revenue.greaterThan(0)
            ? Number(new Prisma.Decimal(f.profit).dividedBy(revenue).times(100).toDP(1).toString())
            : 0,
        };
      }),
    };
  }
}
