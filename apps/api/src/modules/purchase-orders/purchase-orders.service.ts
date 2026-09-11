import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  PURCHASE_FOLIO_PREFIXES,
  type PurchaseTaxMode,
  pendingQuantity,
  purchaseOrderStatusFrom,
} from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { nextFolio } from "../inventory/folio";
import {
  assertActiveWarehouse,
  assertWarehouseInScope,
} from "../inventory/warehouse-scope.helpers";
import { contextoFiscal } from "../pos/tax-resolver";
import { hoyDelNegocio } from "../purchases/business-today";
import {
  armarCompraConGrupos,
  gruposPorCodigo,
  type LineaLista,
} from "../purchases/purchase-lines.service";
import {
  CAMPOS_VIVOS_TRAS_EMITIR,
  type CancelPurchaseOrderDto,
  type CreatePurchaseOrderDto,
  type ListPurchaseOrdersQuery,
  type PurchaseOrderLineDto,
  type ReplacePurchaseOrderLinesDto,
  type UpdatePurchaseOrderDto,
} from "./dto/purchase-order.dto";

export interface PurchaseOrderLineView {
  id: string;
  lineNo: number;
  productId: string;
  productSku: string;
  presentationId: string | null;
  presentationName: string | null;
  quantityOrdered: string;
  quantityReceived: string;
  /** DERIVADO: `pedido − recibido`, nunca negativo. */
  pending: string;
  closedShort: boolean;
  unitCost: string | null;
  discount: string;
  taxGroupCode: string | null;
  taxAmount: string;
  lineTotal: string;
  description: string;
}

export interface PurchaseOrderRow {
  id: string;
  folio: string;
  status: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  orderDate: string;
  expectedDate: string | null;
  supplierReference: string | null;
  paymentTerms: string | null;
  taxMode: PurchaseTaxMode;
  subtotal: string;
  discount: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  lineCount: number;
  createdAt: string;
  issuedAt: string | null;
  closedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface PurchaseOrderProductView {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  presentations: { id: string; name: string; factor: string; isPurchasable: boolean }[];
}

export interface PurchaseOrderReceiptView {
  id: string;
  folio: string;
  status: string;
  receivedDate: string;
  packingSlip: string | null;
  /** La compra que la facturó, si ya se registró. */
  purchase: { id: string; folio: string; status: string } | null;
}

export interface PurchaseOrdersPage {
  rows: PurchaseOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Del FILTRO completo (sin anuladas): cuántas, cuánto esperan y cuántas siguen abiertas. */
  summary: { count: number; total: string; pendingCount: number };
}

export interface PurchaseOrderDetail extends PurchaseOrderRow {
  lines: PurchaseOrderLineView[];
  products: PurchaseOrderProductView[];
  taxes: { code: string; name: string; rate: string; base: string; amount: string }[];
  receipts: PurchaseOrderReceiptView[];
  /** Las compras que nacieron de esta orden. */
  purchases: { id: string; folio: string; status: string; total: string }[];
}

const INCLUDE = {
  supplier: { select: { name: true } },
  warehouse: { select: { name: true } },
  _count: { select: { lines: true } },
} as const;

const DETALLE = {
  ...INCLUDE,
  lines: {
    orderBy: { lineNo: "asc" },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          baseUnit: true,
          presentations: {
            where: { isActive: true },
            orderBy: { factor: "asc" },
            select: { id: true, name: true, factor: true, isPurchasable: true },
          },
        },
      },
      presentation: { select: { name: true } },
    },
  },
  taxes: { orderBy: { sortOrder: "asc" } },
  receipts: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      folio: true,
      status: true,
      receivedDate: true,
      packingSlip: true,
      purchase: { select: { id: true, folio: true, status: true } },
    },
  },
  purchases: {
    orderBy: { createdAt: "asc" },
    select: { id: true, folio: true, status: true, total: true },
  },
} as const;

type FilaConRelaciones = Prisma.PurchaseOrderGetPayload<{ include: typeof INCLUDE }>;
type FilaDetallada = Prisma.PurchaseOrderGetPayload<{ include: typeof DETALLE }>;

const CERO = new Prisma.Decimal(0);
const ABIERTAS = ["open", "partially_received"] as const;

/**
 * F9-PO-04/05 — la ORDEN DE COMPRA: el compromiso con el proveedor.
 *
 * Nace BORRADOR (proveedor, almacén, fecha del pedido) y se captura con
 * autoguardado; se EMITE cuando el pedido está completo (cada línea con su
 * costo acordado: sin él no hay contra qué cotejar la factura); de ahí en
 * adelante su estado lo DERIVAN las recepciones (`purchaseOrderStatusFrom`)
 * y una persona la CIERRA (lo que falta ya no llegará) o la ANULA.
 *
 * Sus totales son ESPERADOS: misma aritmética que la compra (`armarCompra`
 * sin cargos), para que el estimado sea comparable con la factura, pero
 * informativos — nunca contables.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createDraft(
    user: AuthUser,
    scope: UserScope,
    input: CreatePurchaseOrderDto,
    meta: RequestMeta,
  ): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      // El ajuste se exige SOLO para crear: apagarlo no esconde lo que ya
      // existe ni rompe las lecturas.
      const negocio = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { usesPurchaseOrders: true },
      });
      if (!negocio.usesPurchaseOrders) {
        throw new ConflictException({ message: "purchase_orders.not_enabled" });
      }
      const warehouseId = input.warehouseId ?? (await this.almacenAsignado(tx, user));
      assertWarehouseInScope(scope, warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, warehouseId);
      await this.assertProveedor(tx, user.tenantId, input.supplierId);
      await this.assertFechaDelPedido(tx, user.tenantId, input.orderDate);

      const folio = await nextFolio(
        tx,
        user.tenantId,
        "purchase_order",
        PURCHASE_FOLIO_PREFIXES.order,
      );
      // F9-COSTMODE-04: la orden nace en la base del negocio; la compra que
      // salga de sus recepciones copia el de la ORDEN, no el del día.
      const { costTaxMode } = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { costTaxMode: true },
      });
      const creada = await tx.purchaseOrder.create({
        data: {
          tenantId: user.tenantId,
          folio,
          supplierId: input.supplierId,
          warehouseId,
          orderDate: new Date(input.orderDate),
          expectedDate: input.expectedDate == null ? null : new Date(input.expectedDate),
          taxMode: costTaxMode,
          createdBy: user.userId,
        },
        include: DETALLE,
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_orders.create",
        resourceType: "purchase_order",
        resourceId: creada.id,
        after: { folio, supplierId: input.supplierId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(creada);
    });
  }

  async list(
    user: AuthUser,
    scope: UserScope,
    query: ListPurchaseOrdersQuery,
  ): Promise<PurchaseOrdersPage> {
    const where = this.where(user, scope, query);
    const vivas: Prisma.PurchaseOrderWhereInput = {
      AND: [where, { status: { not: "canceled" } }],
    };
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows, agregado, pendientes] = await Promise.all([
        tx.purchaseOrder.count({ where }),
        tx.purchaseOrder.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ orderDate: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.purchaseOrder.aggregate({
          where: vivas,
          _count: { _all: true },
          _sum: { total: true },
        }),
        tx.purchaseOrder.count({ where: { AND: [vivas, { status: { in: [...ABIERTAS] } }] } }),
      ]);
      return {
        rows: rows.map(aFila),
        total,
        page: query.page,
        pageSize: query.pageSize,
        summary: {
          count: agregado._count._all,
          total: (agregado._sum.total ?? CERO).toString(),
          pendingCount: pendientes,
        },
      };
    });
  }

  async detail(user: AuthUser, id: string): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) =>
      this.detailFrom(await this.buscar(tx, user.tenantId, id)),
    );
  }

  /**
   * Autoguardado de la cabecera. En BORRADOR se edita todo; EMITIDA (y
   * mientras se recibe) siguen vivos la fecha esperada, la referencia del
   * proveedor, las condiciones y las notas — promesas y anotaciones, nada
   * que mueva el dinero acordado. Cerrada o anulada, ya no se anota.
   */
  async updateHeader(
    user: AuthUser,
    scope: UserScope,
    id: string,
    input: UpdatePurchaseOrderDto,
    meta: RequestMeta,
  ): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await this.buscar(tx, user.tenantId, id);
      if (actual.status === "closed" || actual.status === "canceled") {
        throw new ConflictException({ message: "purchase_orders.not_editable" });
      }
      if (actual.status !== "draft") {
        const vivos = new Set<string>(CAMPOS_VIVOS_TRAS_EMITIR);
        if (Object.keys(input).some((campo) => !vivos.has(campo))) {
          throw new ConflictException({ message: "purchase_orders.not_draft" });
        }
      }
      if (input.warehouseId !== undefined) {
        assertWarehouseInScope(scope, input.warehouseId);
        await assertActiveWarehouse(tx, user.tenantId, input.warehouseId);
      }
      if (input.supplierId !== undefined) {
        await this.assertProveedor(tx, user.tenantId, input.supplierId);
      }
      if (input.orderDate !== undefined) {
        await this.assertFechaDelPedido(tx, user.tenantId, input.orderDate);
      }
      const data: Prisma.PurchaseOrderUncheckedUpdateInput = {
        ...(input.supplierId !== undefined && { supplierId: input.supplierId }),
        ...(input.warehouseId !== undefined && { warehouseId: input.warehouseId }),
        ...(input.orderDate !== undefined && { orderDate: new Date(input.orderDate) }),
        ...(input.expectedDate !== undefined && {
          expectedDate: input.expectedDate === null ? null : new Date(input.expectedDate),
        }),
        ...(input.supplierReference !== undefined && {
          supplierReference: input.supplierReference,
        }),
        ...(input.paymentTerms !== undefined && { paymentTerms: input.paymentTerms }),
        ...(input.taxMode !== undefined && { taxMode: input.taxMode }),
        ...(input.notes !== undefined && { notes: input.notes }),
      };
      await tx.purchaseOrder.update({ where: { id }, data });
      // Cambiar el modo fiscal cambia la aritmética de todas las líneas.
      if (input.taxMode !== undefined && input.taxMode !== actual.taxMode) {
        await this.recomponer(tx, user.tenantId, id);
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_orders.update",
        resourceType: "purchase_order",
        resourceId: id,
        after: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, id));
    });
  }

  /** Las líneas en BLOQUE: cada guardado recompone los impuestos estimados. */
  async replaceLines(
    user: AuthUser,
    id: string,
    dto: ReplacePurchaseOrderLinesDto,
    meta: RequestMeta,
  ): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.assertDraft(tx, user.tenantId, id);
      const lineas = await this.resolverLineas(tx, user.tenantId, dto.lines);
      await this.recomponer(tx, user.tenantId, id, lineas);
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_orders.lines",
        resourceType: "purchase_order",
        resourceId: id,
        after: { lines: dto.lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, id));
    });
  }

  /**
   * F9-PO-05 — EMITIR: el borrador se vuelve compromiso. Exige al menos una
   * línea y el costo ACORDADO en todas (nombrando la línea): sin precio no
   * hay three-way match, porque no habría contra qué cotejar la factura.
   *
   * ⚠ El orden lo fija el trigger: los impuestos y totales se recomponen
   * ANTES de mover `status`; al revés, la propia transacción vería la orden
   * emitida y Postgres cortaría con `42501`.
   */
  async issue(user: AuthUser, id: string, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await this.assertDraft(tx, user.tenantId, id);
      if (orden.lines.length === 0) {
        throw new UnprocessableEntityException({ message: "purchase_orders.needs_lines" });
      }
      for (const linea of orden.lines) {
        if (linea.unitCost === null) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.line_needs_cost",
            args: { field: `lines.${linea.lineNo}.unitCost` },
          });
        }
      }
      await this.recomponer(tx, user.tenantId, id);
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: "open", issuedAt: new Date(), issuedBy: user.userId },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_orders.issue",
        resourceType: "purchase_order",
        resourceId: id,
        after: { folio: orden.folio, lines: orden.lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, id));
    });
  }

  /**
   * F9-PO-05 — CERRAR: lo que falta ya no llegará. Marca cada línea con
   * pendiente como cerrada corta y sella. Con una recepción en borrador no se
   * cierra: primero se decide qué pasa con ella.
   */
  async close(user: AuthUser, id: string, meta: RequestMeta): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await this.buscar(tx, user.tenantId, id);
      if (!(ABIERTAS as readonly string[]).includes(orden.status) && orden.status !== "received") {
        throw new ConflictException({ message: "purchase_orders.not_closable" });
      }
      if (orden.receipts.some((r) => r.status === "draft")) {
        throw new ConflictException({ message: "purchase_orders.has_draft_receipts" });
      }
      const cortas = orden.lines.filter(
        (l) => !l.closedShort && l.quantityReceived.lessThan(l.quantityOrdered),
      );
      // `closed_short` es de las dos columnas que el trigger deja mover.
      await tx.purchaseOrderLine.updateMany({
        where: { id: { in: cortas.map((l) => l.id) } },
        data: { closedShort: true },
      });
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: "closed", closedAt: new Date(), closedBy: user.userId },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_orders.close",
        resourceType: "purchase_order",
        resourceId: id,
        before: { status: orden.status },
        after: { status: "closed", closedShort: cortas.map((l) => l.lineNo) },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, id));
    });
  }

  /**
   * F9-PO-05 — cerrar corta UNA línea: el proveedor no surtirá el resto de
   * ese artículo, pero la orden sigue viva para los demás. El estado se
   * rederiva: si era la última pendiente, la orden queda `received`.
   */
  async closeLineShort(
    user: AuthUser,
    id: string,
    lineNo: number,
    meta: RequestMeta,
  ): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await this.buscar(tx, user.tenantId, id);
      if (!(ABIERTAS as readonly string[]).includes(orden.status)) {
        throw new ConflictException({ message: "purchase_orders.not_closable" });
      }
      const linea = orden.lines.find((l) => l.lineNo === lineNo);
      if (linea === undefined) {
        throw new NotFoundException({ message: "purchase_orders.line_not_found" });
      }
      await tx.purchaseOrderLine.update({ where: { id: linea.id }, data: { closedShort: true } });
      await this.rederivarEstado(tx, user.tenantId, id);
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_orders.close_line_short",
        resourceType: "purchase_order",
        resourceId: id,
        after: { lineNo },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, id));
    });
  }

  /**
   * F9-PO-05 — ANULAR: solo un borrador o una orden emitida a la que no le
   * ha llegado nada. Con una recepción confirmada la mercancía ya está en el
   * andén: eso se CIERRA, no se anula.
   */
  async cancel(
    user: AuthUser,
    id: string,
    input: CancelPurchaseOrderDto,
    meta: RequestMeta,
  ): Promise<PurchaseOrderDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await this.buscar(tx, user.tenantId, id);
      if (orden.receipts.some((r) => r.status === "confirmed")) {
        throw new ConflictException({ message: "purchase_orders.has_receipts" });
      }
      const tomadas = await tx.purchaseOrder.updateMany({
        where: { id, tenantId: user.tenantId, status: { in: ["draft", "open"] } },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          canceledBy: user.userId,
          cancelReason: input.reason,
        },
      });
      if (tomadas.count !== 1) {
        throw new ConflictException({ message: "purchase_orders.not_cancelable" });
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_orders.cancel",
        resourceType: "purchase_order",
        resourceId: id,
        before: { status: orden.status },
        after: { status: "canceled", reason: input.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, id));
    });
  }

  /**
   * Rederiva el estado de una orden EMITIDA desde sus líneas con la función
   * pura de shared. La usan cerrar corta y —desde F9-PO-07— confirmar y
   * anular una recepción. `closed`/`canceled` no pasan por acá.
   */
  async rederivarEstado(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const lineas = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: id, tenantId },
      select: { quantityOrdered: true, quantityReceived: true, closedShort: true },
    });
    const estado = purchaseOrderStatusFrom(
      lineas.map((l) => ({
        ordered: l.quantityOrdered.toString(),
        received: l.quantityReceived.toString(),
        closedShort: l.closedShort,
      })),
    );
    await tx.purchaseOrder.update({ where: { id }, data: { status: estado } });
    return estado;
  }

  /** La orden, o 404. `tenantId` en el WHERE además de la RLS. */
  async buscar(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const orden = await tx.purchaseOrder.findFirst({ where: { id, tenantId }, include: DETALLE });
    if (orden === null) {
      throw new NotFoundException({ message: "purchase_orders.not_found" });
    }
    return orden;
  }

  async assertDraft(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const orden = await this.buscar(tx, tenantId, id);
    if (orden.status !== "draft") {
      throw new ConflictException({ message: "purchase_orders.not_draft" });
    }
    return orden;
  }

  /** El `where` compartido por listado, conteo y resumen. */
  where(
    user: AuthUser,
    scope: UserScope,
    query: ListPurchaseOrdersQuery,
  ): Prisma.PurchaseOrderWhereInput {
    const texto = query.query?.trim();
    return {
      tenantId: user.tenantId,
      ...(scope.warehouseIds !== "all" && { warehouseId: { in: [...scope.warehouseIds] } }),
      ...(query.warehouseId !== undefined && { warehouseId: query.warehouseId }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.pendingOnly === true && { status: { in: [...ABIERTAS] } }),
      ...(query.pendingInvoice === true && {
        receipts: { some: { status: "confirmed", purchaseId: null } },
      }),
      ...(query.supplierId !== undefined && { supplierId: query.supplierId }),
      ...(query.folio !== undefined && {
        folio: { contains: query.folio, mode: "insensitive" as const },
      }),
      // DATE con DATE, como en la compra: nunca `startOfDayUtc`.
      ...((query.from !== undefined || query.to !== undefined) && {
        orderDate: {
          ...(query.from !== undefined && { gte: new Date(query.from) }),
          ...(query.to !== undefined && { lte: new Date(query.to) }),
        },
      }),
      ...((query.expectedFrom !== undefined || query.expectedTo !== undefined) && {
        expectedDate: {
          ...(query.expectedFrom !== undefined && { gte: new Date(query.expectedFrom) }),
          ...(query.expectedTo !== undefined && { lte: new Date(query.expectedTo) }),
        },
      }),
      ...(texto
        ? {
            OR: [
              { folio: { contains: texto, mode: "insensitive" as const } },
              { supplierReference: { contains: texto, mode: "insensitive" as const } },
              { notes: { contains: texto, mode: "insensitive" as const } },
              { supplier: { name: { contains: texto, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
  }

  /**
   * Recalcula la orden ENTERA con el sumador de la compra (sin cargos) y
   * reescribe impuestos y totales; con `lineas`, también las líneas (solo en
   * borrador: emitida, el trigger las protege). Un solo lugar donde los
   * totales esperados se escriben.
   */
  private async recomponer(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    lineas?: LineaLista[],
  ): Promise<void> {
    const orden = await tx.purchaseOrder.findFirstOrThrow({
      where: { id, tenantId },
      include: { lines: { orderBy: { lineNo: "asc" } } },
    });
    const porCodigo = await gruposPorCodigo(tx, tenantId);
    const partidas: LineaLista[] =
      lineas ??
      orden.lines.map((l) => ({
        productId: l.productId,
        presentationId: l.presentationId,
        quantity: l.quantityOrdered,
        unitCost: l.unitCost,
        discount: l.discount,
        grupo: l.taxGroupCode === null ? null : (porCodigo.get(l.taxGroupCode) ?? null),
        lotCode: null,
        expiresAt: null,
        description: l.description,
      }));
    const resultado = armarCompraConGrupos(partidas, [], orden.taxMode as PurchaseTaxMode);

    // Los impuestos SIEMPRE se rehacen: cualquier cambio los recompone.
    await tx.purchaseOrderTax.deleteMany({ where: { purchaseOrderId: id, tenantId } });
    if (lineas !== undefined) {
      await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id, tenantId } });
      await tx.purchaseOrderLine.createMany({
        data: lineas.map((l, i) => {
          const cuenta = resultado.lines[i];
          return {
            tenantId,
            purchaseOrderId: id,
            lineNo: i + 1,
            productId: l.productId,
            presentationId: l.presentationId,
            quantityOrdered: l.quantity ?? CERO,
            unitCost: l.unitCost,
            discount: l.discount,
            taxGroupCode: cuenta?.taxGroupCode ?? null,
            taxAmount: cuenta?.taxAmount ?? CERO,
            lineTotal: cuenta?.lineTotal ?? CERO,
            description: l.description,
          };
        }),
      });
    } else {
      for (const [i, existente] of orden.lines.entries()) {
        const cuenta = resultado.lines[i];
        await tx.purchaseOrderLine.update({
          where: { id: existente.id },
          data: {
            taxGroupCode: cuenta?.taxGroupCode ?? null,
            taxAmount: cuenta?.taxAmount ?? CERO,
            lineTotal: cuenta?.lineTotal ?? CERO,
          },
        });
      }
    }
    await tx.purchaseOrderTax.createMany({
      data: resultado.byComponent.map((c) => ({
        tenantId,
        purchaseOrderId: id,
        code: c.code,
        name: c.name,
        rate: new Prisma.Decimal(c.rate),
        base: c.base,
        amount: c.amount,
        sortOrder: c.sortOrder,
      })),
    });
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        subtotal: resultado.subtotal,
        discount: resultado.discount,
        taxTotal: resultado.taxTotal,
        total: resultado.total,
      },
    });
  }

  /** Producto del negocio; presentación de ESE producto y activa. */
  private async resolverLineas(
    tx: Prisma.TransactionClient,
    tenantId: string,
    lineas: PurchaseOrderLineDto[],
  ): Promise<LineaLista[]> {
    if (lineas.length === 0) return [];
    const productos = await tx.product.findMany({
      where: { tenantId, id: { in: [...new Set(lineas.map((l) => l.productId))] } },
      select: {
        id: true,
        name: true,
        presentations: { select: { id: true, isActive: true } },
      },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));
    const fiscal = await contextoFiscal(
      tx,
      tenantId,
      lineas.map((l) => l.taxGroupId),
    );
    return lineas.map((linea) => {
      const producto = porId.get(linea.productId);
      if (producto === undefined) {
        throw new NotFoundException({ message: "purchase_orders.product_not_found" });
      }
      let presentationId: string | null = null;
      if (linea.presentationId != null) {
        const presentacion = producto.presentations.find((p) => p.id === linea.presentationId);
        if (presentacion === undefined || !presentacion.isActive) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.presentation_invalid",
          });
        }
        presentationId = presentacion.id;
      }
      const grupo =
        linea.taxGroupId === null
          ? null
          : linea.taxGroupId === undefined
            ? fiscal.porDefecto
            : (fiscal.grupos.get(linea.taxGroupId) ?? null);
      if (linea.taxGroupId != null && grupo === null) {
        throw new UnprocessableEntityException({ message: "catalogs.tax_group_unknown" });
      }
      return {
        productId: linea.productId,
        presentationId,
        quantity: new Prisma.Decimal(linea.quantity),
        unitCost: linea.unitCost == null ? null : new Prisma.Decimal(linea.unitCost),
        discount: new Prisma.Decimal(linea.discount ?? 0),
        grupo,
        lotCode: null,
        expiresAt: null,
        description: producto.name,
      };
    });
  }

  /**
   * La fecha del PEDIDO es de hoy para atrás (con el hoy del negocio). La
   * fecha ESPERADA no pasa por acá: es una promesa y puede ser mañana.
   */
  private async assertFechaDelPedido(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderDate: string,
  ): Promise<void> {
    if (orderDate > (await hoyDelNegocio(tx, tenantId))) {
      throw new UnprocessableEntityException({
        message: "purchase_orders.date_in_future",
        args: { field: "orderDate" },
      });
    }
  }

  private async assertProveedor(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string,
  ) {
    const existe = await tx.supplier.count({ where: { id: supplierId, tenantId } });
    if (existe === 0) {
      throw new NotFoundException({ message: "purchase_orders.supplier_not_found" });
    }
  }

  private async almacenAsignado(tx: Prisma.TransactionClient, user: AuthUser): Promise<string> {
    const fila = await tx.user.findFirst({
      where: { id: user.userId, tenantId: user.tenantId },
      select: { defaultWarehouseId: true },
    });
    if (fila?.defaultWarehouseId == null) {
      throw new ConflictException({ message: "purchase_orders.warehouse_required" });
    }
    return fila.defaultWarehouseId;
  }

  detailFrom(orden: FilaDetallada): PurchaseOrderDetail {
    return {
      ...aFila(orden),
      lines: orden.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        productId: l.productId,
        productSku: l.product.sku,
        presentationId: l.presentationId,
        presentationName: l.presentation?.name ?? null,
        quantityOrdered: l.quantityOrdered.toString(),
        quantityReceived: l.quantityReceived.toString(),
        pending: pendingQuantity(l.quantityOrdered.toString(), l.quantityReceived.toString()),
        closedShort: l.closedShort,
        unitCost: l.unitCost?.toString() ?? null,
        discount: l.discount.toString(),
        taxGroupCode: l.taxGroupCode,
        taxAmount: l.taxAmount.toString(),
        lineTotal: l.lineTotal.toString(),
        description: l.description,
      })),
      products: [...new Map(orden.lines.map((l) => [l.productId, l.product])).values()].map(
        (p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          baseUnit: p.baseUnit,
          presentations: p.presentations.map((pr) => ({
            id: pr.id,
            name: pr.name,
            factor: pr.factor.toString(),
            isPurchasable: pr.isPurchasable,
          })),
        }),
      ),
      taxes: orden.taxes.map((t) => ({
        code: t.code,
        name: t.name,
        rate: t.rate.toString(),
        base: t.base.toString(),
        amount: t.amount.toString(),
      })),
      receipts: orden.receipts.map((r) => ({
        id: r.id,
        folio: r.folio,
        status: r.status,
        receivedDate: fechaIso(r.receivedDate) as string,
        packingSlip: r.packingSlip,
        purchase: r.purchase,
      })),
      purchases: orden.purchases.map((c) => ({
        id: c.id,
        folio: c.folio,
        status: c.status,
        total: c.total.toString(),
      })),
    };
  }
}

const fechaIso = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10);

function aFila(orden: FilaConRelaciones): PurchaseOrderRow {
  return {
    id: orden.id,
    folio: orden.folio,
    status: orden.status,
    supplierId: orden.supplierId,
    supplierName: orden.supplier.name,
    warehouseId: orden.warehouseId,
    warehouseName: orden.warehouse.name,
    orderDate: fechaIso(orden.orderDate) as string,
    expectedDate: fechaIso(orden.expectedDate),
    supplierReference: orden.supplierReference,
    paymentTerms: orden.paymentTerms,
    taxMode: orden.taxMode as PurchaseTaxMode,
    subtotal: orden.subtotal.toString(),
    discount: orden.discount.toString(),
    taxTotal: orden.taxTotal.toString(),
    total: orden.total.toString(),
    notes: orden.notes,
    lineCount: orden._count.lines,
    createdAt: orden.createdAt.toISOString(),
    issuedAt: orden.issuedAt?.toISOString() ?? null,
    closedAt: orden.closedAt?.toISOString() ?? null,
    canceledAt: orden.canceledAt?.toISOString() ?? null,
    cancelReason: orden.cancelReason,
  };
}
