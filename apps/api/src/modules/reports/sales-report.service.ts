import { Injectable } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { assertWarehouseInScope } from "../inventory/warehouse-scope.helpers";
import { buildSalesWhere } from "../pos/sales-where";
import type { SalesReportQueryDto } from "./dto/sales-report.dto";

export interface SalesReportRow {
  id: string;
  folio: string;
  barcode: string | null;
  createdAt: string;
  status: string;
  paymentMethod: string;
  total: string;
  warehouseId: string;
  warehouse: { id: string; name: string };
  seller: { id: string; name: string };
}

/**
 * F5-SALES-01 — las ventas por período, para ANALIZAR.
 *
 * Endpoint propio y no `GET /pos/sales` porque son dos contratos distintos
 * sobre los mismos datos:
 *
 *  · El del POS es el MOSTRADOR (`pos:view`): no aplica alcance, porque la
 *    cajera necesita encontrar el ticket que el cliente trae en la mano sin
 *    importar de qué caja salió.
 *  · Este es el ANÁLISIS (`reports:read`): aplica alcance, porque un Manager
 *    de una bodega no puede enterarse de lo que vendieron las otras.
 *
 * El armado del `where` sí se comparte (`buildSalesWhere`), con las dos
 * semánticas que ese builder arrastra: días del calendario del negocio y
 * folio-o-código-de-barras.
 */
@Injectable()
export class SalesReportService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: AuthUser, scope: UserScope, query: SalesReportQueryDto) {
    const where = await this.where(user, scope, query);

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows, totals] = await Promise.all([
        tx.sale.count({ where }),
        tx.sale.findMany({
          where,
          // Desempate por `id`: dos ventas del MISMO instante quedarían en un
          // orden que Postgres decide y que cambia entre consultas — una fila
          // podría salir en dos páginas o en ninguna.
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: {
            warehouse: { select: { id: true, name: true } },
            seller: { select: { id: true, firstName: true, lastNamePaternal: true } },
          },
        }),
        // Los totales son del PERÍODO entero, no de la página: es el pie de la
        // tabla, y un pie que solo sumara lo visible sería un número inútil.
        // Las ANULADAS quedan fuera: revertida es plata que no entró, y
        // sumarla haría que el reporte no cuadre contra la caja.
        tx.sale.groupBy({
          by: ["paymentMethod"],
          where: { ...where, status: "completed" },
          _sum: { total: true },
        }),
      ]);

      return {
        rows: rows.map((venta) => ({
          id: venta.id,
          folio: venta.folio,
          barcode: venta.barcode,
          createdAt: venta.createdAt.toISOString(),
          status: venta.status,
          paymentMethod: venta.paymentMethod,
          total: venta.total.toString(),
          warehouseId: venta.warehouseId,
          warehouse: venta.warehouse,
          seller: {
            id: venta.seller.id,
            name: `${venta.seller.firstName} ${venta.seller.lastNamePaternal}`.trim(),
          },
        })),
        totals: totals.map((fila) => ({
          paymentMethod: fila.paymentMethod,
          total: new Prisma.Decimal((fila._sum.total ?? 0).toString()).toFixed(2),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async count(user: AuthUser, scope: UserScope, query: SalesReportQueryDto): Promise<number> {
    const where = await this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, (tx) => tx.sale.count({ where }));
  }

  private async where(user: AuthUser, scope: UserScope, query: SalesReportQueryDto) {
    if (query.warehouseId !== undefined) {
      // 403 y no una lista vacía: «ese almacén no vendió nada» sería mentira.
      assertWarehouseInScope(scope, query.warehouseId);
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });

    return buildSalesWhere({
      ...query,
      tenantId: user.tenantId,
      timeZone: tenant?.timezone ?? "UTC",
      // A diferencia del POS, acá el alcance SIEMPRE viaja.
      ...(scope.warehouseIds !== "all" && { warehouseIds: scope.warehouseIds }),
    });
  }
}
