import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { WeightedCostService } from "../cost/weighted-cost.service";

export interface DashboardInventory {
  outOfStock: number;
  belowMin: number;
  /** Presente SOLO con reports:read: el valor del inventario es dinero. */
  inventoryValue?: string;
  attention: {
    productId: string;
    sku: string;
    name: string;
    stock: string;
    stockMin: string;
    /** Días de inventario al ritmo de venta de 14 días; null si no vendió. */
    daysLeft: number | null;
  }[];
}

/**
 * F5-DASH-06 — la salud del stock en tres números y una lista PREDICTIVA.
 *
 * «Agotado» y «bajo mínimo» solo existen para productos con `stockMin > 0`:
 * el mínimo es la declaración de que ese producto DEBE estar — sin ella, un
 * stock en cero no es una emergencia, es un catálogo. La lista de atención
 * ordena por urgencia real: días estimados = stock ÷ velocidad de venta de
 * los últimos 14 días (los movimientos de venta del kardex, en unidad base).
 * Quien no vendió en 14 días no tiene ritmo — `daysLeft: null`, jamás
 * Infinity — y espera al final.
 *
 * El VALOR del inventario es dinero del negocio: viaja solo con
 * `reports:read` (gating por campo — el resto del widget es de quien opera
 * el almacén con `inventory:read`).
 */
@Injectable()
export class DashboardInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly weightedCost: WeightedCostService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async inventory(user: AuthUser, scope: UserScope): Promise<DashboardInventory> {
    const almacenes = scope.warehouseIds === "all" ? null : [...scope.warehouseIds];
    const hace14Dias = new Date(this.clock.now().getTime() - 14 * 24 * 60 * 60 * 1000);

    const filas = await this.prisma.withTenantContext(
      user.tenantId,
      (tx) =>
        tx.$queryRaw<
          { product_id: string; sku: string; name: string; stock_min: string; total: string }[]
        >`
        SELECT p.id AS product_id, p.sku, p.name, p.stock_min::text,
               COALESCE(SUM(sw.quantity), 0)::text AS total
          FROM products p
          LEFT JOIN stock_by_warehouse sw
            ON sw.product_id = p.id
           AND (${almacenes}::uuid[] IS NULL OR sw.warehouse_id = ANY(${almacenes}::uuid[]))
         WHERE p.tenant_id = ${user.tenantId}::uuid
           AND p.is_active = true
           AND p.is_composite = false
         GROUP BY p.id, p.sku, p.name, p.stock_min`,
    );

    const conMinimo = filas.filter((f) => new Prisma.Decimal(f.stock_min).greaterThan(0));
    const agotados = conMinimo.filter((f) => !new Prisma.Decimal(f.total).greaterThan(0));
    const bajoMinimo = conMinimo.filter((f) => {
      const total = new Prisma.Decimal(f.total);
      return total.greaterThan(0) && total.lessThan(new Prisma.Decimal(f.stock_min));
    });

    // La velocidad: unidades VENDIDAS (kardex, reason 'sale') en 14 días.
    const enRiesgo = [...agotados, ...bajoMinimo];
    const velocidades = enRiesgo.length
      ? await this.prisma.withTenantContext(
          user.tenantId,
          (tx) =>
            tx.$queryRaw<{ product_id: string; sold: string }[]>`
            SELECT m.product_id, SUM(m.quantity)::text AS sold
              FROM stock_movements m
             WHERE m.tenant_id = ${user.tenantId}::uuid
               AND m.reason_code = 'sale'
               AND m.product_id = ANY(${enRiesgo.map((f) => f.product_id)}::uuid[])
               AND (${almacenes}::uuid[] IS NULL OR m.warehouse_id = ANY(${almacenes}::uuid[]))
               AND m.created_at >= ${hace14Dias}
             GROUP BY m.product_id`,
        )
      : [];
    const vendidoEn14 = new Map(velocidades.map((f) => [f.product_id, new Prisma.Decimal(f.sold)]));

    const attention = enRiesgo
      .map((f) => {
        const vendido = vendidoEn14.get(f.product_id);
        const conRitmo = vendido !== undefined && vendido.greaterThan(0);
        return {
          productId: f.product_id,
          sku: f.sku,
          name: f.name,
          stock: f.total,
          stockMin: f.stock_min,
          // Stock en cero o abajo = 0 días, SIEMPRE (Carlos, 2026-09-01):
          // «−14 días restantes» no significa nada para quien repone, y el
          // «sin ritmo» tampoco aplica — lo que está en cero ya se acabó.
          daysLeft: new Prisma.Decimal(f.total).lessThanOrEqualTo(0)
            ? 0
            : conRitmo
              ? Number(
                  new Prisma.Decimal(f.total).dividedBy(vendido.dividedBy(14)).toDP(1).toString(),
                )
              : null,
        };
      })
      // Urgencia: menos días primero; sin ritmo (null) al final — no se sabe
      // cuándo se acaba lo que no se mueve.
      .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity))
      .slice(0, 5);

    const respuesta: DashboardInventory = {
      outOfStock: agotados.length,
      belowMin: bajoMinimo.length,
      attention,
    };

    if (user.permissions?.includes("reports:read")) {
      // Valorización con el costo ponderado (F5-COST): solo productos con
      // historial de compra aportan — el costo desconocido no se inventa.
      const conStock = filas.filter((f) => new Prisma.Decimal(f.total).greaterThan(0));
      const costos = await this.weightedCost.averageCosts(
        user.tenantId,
        conStock.map((f) => f.product_id),
      );
      let valor = new Prisma.Decimal(0);
      for (const fila of conStock) {
        const costo = costos.get(fila.product_id);
        if (costo !== undefined) {
          valor = valor.plus(costo.times(new Prisma.Decimal(fila.total)));
        }
      }
      respuesta.inventoryValue = valor.toDP(2).toString();
    }

    return respuesta;
  }
}
