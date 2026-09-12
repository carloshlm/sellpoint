import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { PURCHASE_FOLIO_PREFIXES, pendingQuantity } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { nextFolio } from "../inventory/folio";
import { hoyDelNegocio } from "../purchases/business-today";
import { aplicarReglasDeLote } from "../purchases/lot-rules";
import type {
  CancelPurchaseReceiptDto,
  ReplacePurchaseReceiptLinesDto,
  UpdatePurchaseReceiptDto,
} from "./dto/purchase-receipt.dto";
import { PurchaseOrdersService } from "./purchase-orders.service";

export interface PurchaseReceiptLineView {
  id: string;
  lineNo: number;
  purchaseOrderLineId: string;
  orderLineNo: number;
  productId: string;
  productSku: string;
  description: string;
  presentationName: string | null;
  tracksLots: boolean;
  quantityOrdered: string;
  /** Lo recibido en la orden HOY (con esta recepción, si ya se confirmó). */
  quantityReceived: string;
  /** Lo que la orden todavía espera de esa línea. */
  pending: string;
  quantity: string;
  lotCode: string | null;
  expiresAt: string | null;
  notes: string | null;
}

export interface PurchaseReceiptDetail {
  id: string;
  folio: string;
  status: string;
  purchaseOrderId: string;
  orderFolio: string;
  orderStatus: string;
  receivedDate: string;
  packingSlip: string | null;
  notes: string | null;
  /** La compra que la facturó, si ya se registró. */
  purchase: { id: string; folio: string; status: string } | null;
  lines: PurchaseReceiptLineView[];
  createdAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

const DETALLE = {
  purchaseOrder: { select: { folio: true, status: true } },
  purchase: { select: { id: true, folio: true, status: true } },
  lines: {
    orderBy: { lineNo: "asc" },
    include: {
      purchaseOrderLine: {
        include: {
          product: { select: { id: true, sku: true, tracksLots: true } },
          presentation: { select: { name: true } },
        },
      },
    },
  },
} as const;

type FilaDetallada = Prisma.PurchaseReceiptGetPayload<{ include: typeof DETALLE }>;
const RECIBIBLES = ["open", "partially_received"] as const;

/** Las líneas de la orden, TOMADAS con `FOR UPDATE`: nadie más recibe hasta el commit. */
async function lineasBloqueadas(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$queryRaw`SELECT id FROM purchase_order_lines WHERE purchase_order_id = ${orderId}::uuid FOR UPDATE`;
  return tx.purchaseOrderLine.findMany({
    where: { purchaseOrderId: orderId },
    select: {
      id: true,
      lineNo: true,
      quantityOrdered: true,
      quantityReceived: true,
      closedShort: true,
    },
  });
}

/**
 * F9-PO-07 — la RECEPCIÓN: qué llegó al andén, con qué remisión y con qué
 * lote. **No mueve existencias**: confirmarla suma `quantity_received` en la
 * línea de la orden y rederiva el estado; la mercancía entra al kardex por
 * la entrada de la compra que se registre sobre lo recibido.
 *
 * La regla del andén: una línea no puede recibir más de lo pendiente. Al
 * guardar se valida de cortesía; la validación que MANDA es la de `confirm`,
 * con las líneas de la orden tomadas con `FOR UPDATE` — dos recepciones a la
 * vez no pueden recibir 60 + 60 de 100.
 */
@Injectable()
export class PurchaseReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  /** Nace con las líneas PRELLENADAS con lo pendiente: lo normal es que llegue todo. */
  async createDraft(
    user: AuthUser,
    orderId: string,
    meta: RequestMeta,
  ): Promise<PurchaseReceiptDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await this.orders.buscar(tx, user.tenantId, orderId);
      if (!(RECIBIBLES as readonly string[]).includes(orden.status)) {
        throw new ConflictException({ message: "purchase_orders.not_receivable" });
      }
      const folio = await nextFolio(
        tx,
        user.tenantId,
        "purchase_receipt",
        PURCHASE_FOLIO_PREFIXES.receipt,
      );
      const pendientes = orden.lines.filter(
        (l) => !l.closedShort && l.quantityReceived.lessThan(l.quantityOrdered),
      );
      const creada = await tx.purchaseReceipt.create({
        data: {
          tenantId: user.tenantId,
          folio,
          purchaseOrderId: orderId,
          receivedDate: new Date(await hoyDelNegocio(tx, user.tenantId)),
          createdBy: user.userId,
          lines: {
            create: pendientes.map((l, i) => ({
              tenantId: user.tenantId,
              lineNo: i + 1,
              purchaseOrderLineId: l.id,
              quantity: l.quantityOrdered.minus(l.quantityReceived),
            })),
          },
        },
        select: { id: true },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_receipts.create",
        resourceType: "purchase_receipt",
        resourceId: creada.id,
        after: { folio, order: orden.folio, lines: pendientes.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, orderId, creada.id));
    });
  }

  async list(user: AuthUser, orderId: string): Promise<PurchaseReceiptDetail[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.orders.buscar(tx, user.tenantId, orderId);
      const filas = await tx.purchaseReceipt.findMany({
        where: { tenantId: user.tenantId, purchaseOrderId: orderId },
        include: DETALLE,
        orderBy: { createdAt: "asc" },
      });
      return filas.map((f) => this.detailFrom(f));
    });
  }

  async detail(user: AuthUser, orderId: string, receiptId: string) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) =>
      this.detailFrom(await this.buscar(tx, user.tenantId, orderId, receiptId)),
    );
  }

  async updateHeader(
    user: AuthUser,
    orderId: string,
    receiptId: string,
    input: UpdatePurchaseReceiptDto,
    meta: RequestMeta,
  ): Promise<PurchaseReceiptDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.assertDraft(tx, user.tenantId, orderId, receiptId);
      if (input.receivedDate !== undefined) {
        // Una recepción es un HECHO: de hoy para atrás, con el hoy del negocio.
        if (input.receivedDate > (await hoyDelNegocio(tx, user.tenantId))) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.receipt_date_in_future",
            args: { field: "receivedDate" },
          });
        }
      }
      await tx.purchaseReceipt.update({
        where: { id: receiptId },
        data: {
          ...(input.receivedDate !== undefined && { receivedDate: new Date(input.receivedDate) }),
          ...(input.packingSlip !== undefined && { packingSlip: input.packingSlip }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_receipts.update",
        resourceType: "purchase_receipt",
        resourceId: receiptId,
        after: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, orderId, receiptId));
    });
  }

  /**
   * Las líneas en BLOQUE. Cada una apunta a una línea de ESTA orden que no
   * esté cerrada corta, no supera lo pendiente (validación de cortesía: la
   * que manda es la del `confirm`) y cumple las reglas de lote de la compra.
   */
  async replaceLines(
    user: AuthUser,
    orderId: string,
    receiptId: string,
    dto: ReplacePurchaseReceiptLinesDto,
    meta: RequestMeta,
  ): Promise<PurchaseReceiptDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.assertDraft(tx, user.tenantId, orderId, receiptId);
      const orden = await this.orders.buscar(tx, user.tenantId, orderId);
      const porId = new Map(orden.lines.map((l) => [l.id, l]));
      dto.lines.forEach((linea, index) => {
        const deOrden = porId.get(linea.purchaseOrderLineId);
        if (deOrden === undefined) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.receipt_line_foreign",
            args: { field: `lines.${index + 1}.purchaseOrderLineId` },
          });
        }
        if (deOrden.closedShort) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.line_closed_short",
            args: { field: `lines.${index + 1}.quantity` },
          });
        }
        const pendiente = deOrden.quantityOrdered.minus(deOrden.quantityReceived);
        if (new Prisma.Decimal(linea.quantity).greaterThan(pendiente)) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.over_receipt",
            args: {
              field: `lines.${index + 1}.quantity`,
              line: index + 1,
              pending: pendiente.toString(),
            },
          });
        }
      });
      const lotes = await aplicarReglasDeLote(
        tx,
        user.tenantId,
        dto.lines.map((l) => ({
          productId: porId.get(l.purchaseOrderLineId)?.productId as string,
          lotCode: l.lotCode ?? null,
          expiresAt: l.expiresAt ?? null,
        })),
      );
      await tx.purchaseReceiptLine.deleteMany({ where: { receiptId, tenantId: user.tenantId } });
      await tx.purchaseReceiptLine.createMany({
        data: dto.lines.map((l, i) => ({
          tenantId: user.tenantId,
          receiptId,
          lineNo: i + 1,
          purchaseOrderLineId: l.purchaseOrderLineId,
          quantity: new Prisma.Decimal(l.quantity),
          lotCode: lotes[i]?.lotCode ?? null,
          expiresAt: lotes[i]?.expiresAt ?? null,
          notes: l.notes ?? null,
        })),
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_receipts.lines",
        resourceType: "purchase_receipt",
        resourceId: receiptId,
        after: { lines: dto.lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, orderId, receiptId));
    });
  }

  /**
   * CONFIRMAR: la validación que manda. Toma las líneas de la orden con
   * `FOR UPDATE`, revalida cada cantidad contra el pendiente YA con el lock,
   * suma lo recibido, rederiva el estado de la orden y sella. Nada de stock.
   */
  async confirm(
    user: AuthUser,
    orderId: string,
    receiptId: string,
    meta: RequestMeta,
  ): Promise<PurchaseReceiptDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const recepcion = await this.assertDraft(tx, user.tenantId, orderId, receiptId);
      if (recepcion.lines.length === 0) {
        throw new UnprocessableEntityException({ message: "purchase_orders.receipt_needs_lines" });
      }
      if (!(RECIBIBLES as readonly string[]).includes(recepcion.purchaseOrder.status)) {
        throw new ConflictException({ message: "purchase_orders.not_receivable" });
      }
      const bloqueadas = new Map((await lineasBloqueadas(tx, orderId)).map((l) => [l.id, l]));
      // Varias líneas de la recepción pueden apuntar a la misma línea de la
      // orden (dos lotes): se suma por línea de orden antes de comparar.
      const porLineaDeOrden = new Map<string, Prisma.Decimal>();
      for (const linea of recepcion.lines) {
        porLineaDeOrden.set(
          linea.purchaseOrderLineId,
          (porLineaDeOrden.get(linea.purchaseOrderLineId) ?? new Prisma.Decimal(0)).plus(
            linea.quantity,
          ),
        );
      }
      for (const [index, linea] of recepcion.lines.entries()) {
        const deOrden = bloqueadas.get(linea.purchaseOrderLineId);
        if (deOrden === undefined || deOrden.closedShort) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.line_closed_short",
            args: { field: `lines.${index + 1}.quantity` },
          });
        }
        const pendiente = deOrden.quantityOrdered.minus(deOrden.quantityReceived);
        const total = porLineaDeOrden.get(linea.purchaseOrderLineId) ?? new Prisma.Decimal(0);
        if (total.greaterThan(pendiente)) {
          throw new UnprocessableEntityException({
            message: "purchase_orders.over_receipt",
            args: {
              field: `lines.${index + 1}.quantity`,
              line: index + 1,
              pending: pendiente.toString(),
            },
          });
        }
      }
      for (const [lineaId, cantidad] of porLineaDeOrden) {
        // `quantity_received` es de las dos columnas que el trigger deja mover.
        await tx.purchaseOrderLine.update({
          where: { id: lineaId },
          data: { quantityReceived: { increment: cantidad } },
        });
      }
      const estado = await this.orders.rederivarEstado(tx, user.tenantId, orderId);
      await tx.purchaseReceipt.update({
        where: { id: receiptId },
        data: { status: "confirmed", confirmedAt: new Date(), confirmedBy: user.userId },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_receipts.confirm",
        resourceType: "purchase_receipt",
        resourceId: receiptId,
        after: {
          folio: recepcion.folio,
          order: recepcion.purchaseOrder.folio,
          orderStatus: estado,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, orderId, receiptId));
    });
  }

  /**
   * ANULAR: un borrador se anula sin más; una confirmada devuelve lo recibido
   * a la orden (con el mismo lock) y rederiva el estado — una orden
   * `received` vuelve a `partially_received`. Facturada, no: la compra que la
   * facturó ya cuenta con ella (409); anular esa compra la libera primero.
   */
  async cancel(
    user: AuthUser,
    orderId: string,
    receiptId: string,
    input: CancelPurchaseReceiptDto,
    meta: RequestMeta,
  ): Promise<PurchaseReceiptDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const recepcion = await this.buscar(tx, user.tenantId, orderId, receiptId);
      if (recepcion.status === "canceled") {
        throw new ConflictException({ message: "purchase_orders.receipt_already_canceled" });
      }
      if (recepcion.purchase !== null && recepcion.purchase.status !== "canceled") {
        throw new ConflictException({ message: "purchase_orders.receipt_invoiced" });
      }
      if (recepcion.status === "confirmed") {
        await lineasBloqueadas(tx, orderId);
        for (const linea of recepcion.lines) {
          await tx.purchaseOrderLine.update({
            where: { id: linea.purchaseOrderLineId },
            data: { quantityReceived: { decrement: linea.quantity } },
          });
        }
        if (
          (RECIBIBLES as readonly string[]).includes(recepcion.purchaseOrder.status) ||
          recepcion.purchaseOrder.status === "received"
        ) {
          await this.orders.rederivarEstado(tx, user.tenantId, orderId);
        }
      }
      await tx.purchaseReceipt.update({
        where: { id: receiptId },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          canceledBy: user.userId,
          cancelReason: input.reason,
        },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchase_receipts.cancel",
        resourceType: "purchase_receipt",
        resourceId: receiptId,
        before: { status: recepcion.status },
        after: { status: "canceled", reason: input.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(await this.buscar(tx, user.tenantId, orderId, receiptId));
    });
  }

  async buscar(tx: Prisma.TransactionClient, tenantId: string, orderId: string, receiptId: string) {
    const recepcion = await tx.purchaseReceipt.findFirst({
      where: { id: receiptId, tenantId, purchaseOrderId: orderId },
      include: DETALLE,
    });
    if (recepcion === null) {
      throw new NotFoundException({ message: "purchase_orders.receipt_not_found" });
    }
    return recepcion;
  }

  private async assertDraft(
    tx: Prisma.TransactionClient,
    tenantId: string,
    orderId: string,
    receiptId: string,
  ) {
    const recepcion = await this.buscar(tx, tenantId, orderId, receiptId);
    if (recepcion.status !== "draft") {
      throw new ConflictException({ message: "purchase_orders.receipt_not_draft" });
    }
    return recepcion;
  }

  detailFrom(r: FilaDetallada): PurchaseReceiptDetail {
    const fecha = (d: Date | null) => (d === null ? null : d.toISOString().slice(0, 10));
    return {
      id: r.id,
      folio: r.folio,
      status: r.status,
      purchaseOrderId: r.purchaseOrderId,
      orderFolio: r.purchaseOrder.folio,
      orderStatus: r.purchaseOrder.status,
      receivedDate: fecha(r.receivedDate) as string,
      packingSlip: r.packingSlip,
      notes: r.notes,
      purchase: r.purchase,
      lines: r.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        purchaseOrderLineId: l.purchaseOrderLineId,
        orderLineNo: l.purchaseOrderLine.lineNo,
        productId: l.purchaseOrderLine.product.id,
        productSku: l.purchaseOrderLine.product.sku,
        description: l.purchaseOrderLine.description,
        presentationName: l.purchaseOrderLine.presentation?.name ?? null,
        tracksLots: l.purchaseOrderLine.product.tracksLots,
        quantityOrdered: l.purchaseOrderLine.quantityOrdered.toString(),
        quantityReceived: l.purchaseOrderLine.quantityReceived.toString(),
        pending: pendingQuantity(
          l.purchaseOrderLine.quantityOrdered.toString(),
          l.purchaseOrderLine.quantityReceived.toString(),
        ),
        quantity: l.quantity.toString(),
        lotCode: l.lotCode,
        expiresAt: fecha(l.expiresAt),
        notes: l.notes,
      })),
      createdAt: r.createdAt.toISOString(),
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      canceledAt: r.canceledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
    };
  }
}
