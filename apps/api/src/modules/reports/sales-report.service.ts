import { Injectable } from "@nestjs/common";
import { shortName } from "@sellpoint/shared";
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
  /** F4-TAX-21: el impuesto que viaja dentro del total (0 en ventas de antes del módulo). */
  taxTotal: string;
  warehouseId: string;
  warehouse: { id: string; name: string };
  seller: { id: string; name: string };
  /**
   * F10-KPI-11: el descuento TOTAL de la venta —el de sus líneas más el del
   * ticket, que es lo que `sales.discount` ya guarda—, con dos decimales.
   * «0.00» si no hubo descuento: es un cero real, no un dato que falta.
   */
  discount: string;
  /** Por qué se descontó, en palabras del cajero; `null` si no lo dijo. */
  discountReason: string | null;
  /** Por qué se canceló; `null` en las cobradas. */
  cancelReason: string | null;
  canceledAt: string | null;
  canceledBy: { id: string; name: string } | null;
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
      const cobradas: Prisma.SaleWhereInput = { AND: [where, { status: "completed" }] };
      const [total, rows, totals, descuentos] = await Promise.all([
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
            seller: { select: { id: true, firstName: true, lastName: true } },
            // Quién canceló viaja en la MISMA consulta (la relación `canceler`):
            // nunca una consulta por fila.
            canceler: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
        // Los totales son del PERÍODO entero, no de la página: es el pie de la
        // tabla, y un pie que solo sumara lo visible sería un número inútil.
        // Las ANULADAS quedan fuera: revertida es plata que no entró, y
        // sumarla haría que el reporte no cuadre contra la caja. `AND` y no
        // `{ ...where, status }`: el spread PISABA el filtro de Estado, y con
        // «Cancelada» el pie sumaba las cobradas que la tabla no lista
        // (Carlos, 2026-11-02). Ahora con «Cancelada» no hay nada que sumar.
        tx.sale.groupBy({
          by: ["paymentMethod"],
          where: cobradas,
          _sum: { total: true },
        }),
        // F10-KPI-11: lo que se fue en descuentos, con la misma regla que el
        // pie: del periodo filtrado entero y solo de las cobradas. Una venta
        // cancelada no le costó nada al negocio.
        tx.sale.aggregate({ where: cobradas, _sum: { discount: true } }),
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
          taxTotal: venta.taxTotal.toString(),
          warehouseId: venta.warehouseId,
          warehouse: venta.warehouse,
          seller: {
            id: venta.seller.id,
            name: shortName(venta.seller),
          },
          discount: venta.discount.toFixed(2),
          discountReason: venta.discountReason,
          cancelReason: venta.cancelReason,
          canceledAt: venta.canceledAt?.toISOString() ?? null,
          canceledBy:
            venta.canceler === null
              ? null
              : { id: venta.canceler.id, name: shortName(venta.canceler) },
        })),
        totals: totals.map((fila) => ({
          paymentMethod: fila.paymentMethod,
          total: new Prisma.Decimal((fila._sum.total ?? 0).toString()).toFixed(2),
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
        // Al final: un campo nuevo no mueve los de siempre. Suma de un periodo
        // sin descuentos = «0.00», un cero real.
        discountTotal: new Prisma.Decimal((descuentos._sum.discount ?? 0).toString()).toFixed(2),
      };
    });
  }

  async count(user: AuthUser, scope: UserScope, query: SalesReportQueryDto): Promise<number> {
    const where = await this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, (tx) => tx.sale.count({ where }));
  }

  /**
   * El `where` de las ventas con el alcance encima. Público porque «Ventas por
   * producto» y «Ventas por servicio» (`SalesLinesReportService`) filtran las
   * MISMAS ventas: una segunda copia del alcance y de la zona del negocio
   * diría otra cosa el día que una de las dos cambie.
   */
  async where(
    user: AuthUser,
    scope: UserScope,
    query: SalesReportQueryDto,
  ): Promise<Prisma.SaleWhereInput> {
    if (query.warehouseId !== undefined) {
      // 403 y no una lista vacía: «ese almacén no vendió nada» sería mentira.
      assertWarehouseInScope(scope, query.warehouseId);
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: { timezone: true },
    });

    const { discounted, ...filtros } = query;
    const ventas = buildSalesWhere({
      ...filtros,
      tenantId: user.tenantId,
      timeZone: tenant?.timezone ?? "UTC",
      // A diferencia del POS, acá el alcance SIEMPRE viaja.
      ...(scope.warehouseIds !== "all" && { warehouseIds: scope.warehouseIds }),
    });
    // F10-KPI-11 — «Solo con descuento» se resuelve AQUÍ y no en
    // `buildSalesWhere`: ese builder también arma el historial del POS, que no
    // tiene este filtro, y su contrato no se toca. `AND` y no un spread, para
    // no pisar nada de lo que el builder diga.
    return discounted === true ? { AND: [ventas, { discount: { gt: 0 } }] } : ventas;
  }
}
