import { Injectable } from "@nestjs/common";
import { shortName } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { descripcionDeFila } from "../pos/ticket.service";
import type { SalesReportQueryDto } from "./dto/sales-report.dto";
import { SalesReportService } from "./sales-report.service";

/**
 * Qué líneas lee el reporte: las de PRODUCTO («Ventas por producto») o las de
 * SERVICIO («Ventas por servicio»). Es la única diferencia entre los dos; el
 * resto —filtros, alcance, orden, pie, Excel— es uno solo.
 */
export type SaleLineKind = "product" | "service";

/** Una línea de ticket, con lo que la pantalla y el Excel necesitan de su venta. */
export interface SalesLineRow {
  id: string;
  saleId: string;
  folio: string;
  createdAt: string;
  status: string;
  warehouseId: string;
  warehouse: { id: string; name: string };
  seller: { id: string; name: string };
  /** El código interno del producto (`sku`) o el código del servicio. */
  code: string | null;
  /**
   * El código de barras de la PRESENTACIÓN vendida, el que lee el escáner.
   * La línea no guarda el que se escaneó: es el vigente de esa presentación.
   * Null en servicios y en presentaciones sin código.
   */
  barcode: string | null;
  name: string;
  /** En la presentación vendida, como la tecleó el cajero: «1» caja, no «12» piezas. */
  quantity: string;
  /** Null en un servicio: no sale del anaquel, como en el ticket. */
  baseUnit: string | null;
  presentation: { name: string; factor: string; allowFractionalInput: boolean } | null;
  unitPrice: string;
  /** El impuesto de la línea: lo que el motor le repartió de cada componente. */
  taxAmount: string;
  /** Lo que cobró la línea, después de su descuento y de su parte del del ticket. */
  lineTotal: string;
}

export interface SalesLinesPage {
  rows: SalesLineRow[];
  /** Del PERÍODO entero y solo de lo cobrado; null si no hay nada cobrado. */
  totals: { tax: string; total: string } | null;
  total: number;
  page: number;
  pageSize: number;
}

const COLUMNAS = {
  id: true,
  quantity: true,
  unitPrice: true,
  taxAmount: true,
  lineTotal: true,
  conceptDescription: true,
  sale: {
    select: {
      id: true,
      folio: true,
      createdAt: true,
      status: true,
      warehouseId: true,
      warehouse: { select: { id: true, name: true } },
      seller: { select: { id: true, firstName: true, lastName: true } },
    },
  },
  product: { select: { sku: true, name: true, baseUnit: true } },
  service: { select: { code: true, name: true } },
  presentation: {
    select: { name: true, factor: true, barcode: true, allowFractionalInput: true },
  },
} satisfies Prisma.SaleItemSelect;

/**
 * El orden de Ventas —la más nueva primero, con el `id` de desempate para que
 * una fila no salga en dos páginas— y, dentro de cada venta, el orden del
 * ticket.
 */
const ORDEN = [
  { sale: { createdAt: "desc" } },
  { sale: { id: "desc" } },
  { lineNo: "asc" },
] satisfies Prisma.SaleItemOrderByWithRelationInput[];

/**
 * «Ventas por producto» y «Ventas por servicio»: el reporte de Ventas con UNA
 * LÍNEA de ticket por renglón.
 *
 * Filtra las mismas ventas que Ventas (`SalesReportService.where`: alcance,
 * calendario del negocio, sucursal y estado) y lee sus líneas. Las ANULADAS
 * se listan, como en Ventas, pero no suman en el pie.
 *
 * ── Por qué el Total de la línea es `line_total` ────────────────────────
 *
 * Es lo que la línea cobró: su precio por su cantidad, menos su descuento y
 * menos la parte del descuento del TICKET que el cobro le prorrateó en
 * centavos exactos (F4-DISC). Por eso las líneas de una venta suman su total.
 * El ticket impreso, en cambio, pinta cada fila a precio de lista y el
 * descuento una vez en el pie (Carlos, 2026-09-09): acá no hay pie por ticket
 * donde ponerlo.
 *
 * Las líneas de CONCEPTO (texto libre de una cotización: sin producto ni
 * servicio) caen en «por producto», que lee las líneas SIN servicio.
 */
@Injectable()
export class SalesLinesReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesReportService,
  ) {}

  async list(
    user: AuthUser,
    scope: UserScope,
    query: SalesReportQueryDto,
    kind: SaleLineKind,
  ): Promise<SalesLinesPage> {
    const { where, ventas } = await this.where(user, scope, query, kind);

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, filas, suma] = await Promise.all([
        tx.saleItem.count({ where }),
        tx.saleItem.findMany({
          where,
          orderBy: ORDEN,
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: COLUMNAS,
        }),
        // El pie es del PERÍODO, no de la página, y sin las anuladas: plata
        // revertida no entró. Un `AND` y no pisar `status`, para que filtrar
        // las anuladas deje el pie vacío en vez de mostrar las cobradas.
        tx.saleItem.aggregate({
          where: { ...where, sale: { AND: [ventas, { status: "completed" }] } },
          _sum: { taxAmount: true, lineTotal: true },
        }),
      ]);

      return {
        rows: filas.map(aFila),
        totals:
          suma._sum.lineTotal === null
            ? null
            : {
                tax: new Prisma.Decimal(suma._sum.taxAmount ?? 0).toFixed(2),
                total: suma._sum.lineTotal.toFixed(2),
              },
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async count(
    user: AuthUser,
    scope: UserScope,
    query: SalesReportQueryDto,
    kind: SaleLineKind,
  ): Promise<number> {
    const { where } = await this.where(user, scope, query, kind);
    return this.prisma.withTenantContext(user.tenantId, (tx) => tx.saleItem.count({ where }));
  }

  /**
   * Todas las líneas, sin paginar: para el Excel, que ya contó primero y no
   * llega acá si pasa del tope (`exportWithLimit`).
   */
  async all(
    user: AuthUser,
    scope: UserScope,
    query: SalesReportQueryDto,
    kind: SaleLineKind,
  ): Promise<SalesLineRow[]> {
    const { where } = await this.where(user, scope, query, kind);
    return this.prisma.withTenantContext(user.tenantId, async (tx) =>
      (await tx.saleItem.findMany({ where, orderBy: ORDEN, select: COLUMNAS })).map(aFila),
    );
  }

  /** La zona del negocio: la fecha del Excel se escribe en su hora. */
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
    query: SalesReportQueryDto,
    kind: SaleLineKind,
  ): Promise<{ where: Prisma.SaleItemWhereInput; ventas: Prisma.SaleWhereInput }> {
    const ventas = await this.sales.where(user, scope, query);
    return {
      ventas,
      where: {
        tenantId: user.tenantId,
        serviceId: kind === "service" ? { not: null } : null,
        sale: ventas,
      },
    };
  }
}

type LineaLeida = Prisma.SaleItemGetPayload<{ select: typeof COLUMNAS }>;

function aFila(linea: LineaLeida): SalesLineRow {
  const { sale, product, service, presentation } = linea;
  return {
    id: linea.id,
    saleId: sale.id,
    folio: sale.folio,
    createdAt: sale.createdAt.toISOString(),
    status: sale.status,
    warehouseId: sale.warehouseId,
    warehouse: sale.warehouse,
    seller: { id: sale.seller.id, name: shortName(sale.seller) },
    code: product?.sku ?? service?.code ?? null,
    barcode: presentation?.barcode ?? null,
    // El MISMO texto que el ticket: el nombre vigente del producto o del
    // servicio, o la descripción del concepto.
    name: descripcionDeFila(linea, product ?? undefined, service ?? undefined),
    quantity: linea.quantity.toString(),
    baseUnit: product?.baseUnit ?? null,
    presentation:
      presentation === null
        ? null
        : {
            name: presentation.name,
            factor: presentation.factor.toString(),
            allowFractionalInput: presentation.allowFractionalInput,
          },
    unitPrice: linea.unitPrice.toFixed(2),
    taxAmount: linea.taxAmount.toFixed(2),
    lineTotal: linea.lineTotal.toFixed(2),
  };
}
