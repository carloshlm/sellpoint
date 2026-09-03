import { randomUUID } from "node:crypto";
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  MEDICAL_CLINIC_FOLIO_PREFIXES,
  type MedicalOrderKind,
  medicalRecordLock,
  POS_FOLIO_PREFIXES,
} from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { nextFolio } from "../inventory/folio";
import { QuotesService } from "../pos/quotes.service";
import { diaDelNegocio } from "./business-day";
import type { CreateOrderDto, PrescriptionLineDto } from "./dto/orders.dto";
import { SettingsService } from "./settings.service";

export const SOURCE_MODULE = "medical_clinic";

export type ChargeStatus = "charged" | "pending" | "not_for_sale";

export interface OrderLineView {
  id: string;
  lineNo: number;
  productId: string | null;
  presentationId: string | null;
  labStudyId: string | null;
  diagnosticStudyId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  dosage: string | null;
}

export interface OrderView {
  id: string;
  recordId: string;
  kind: MedicalOrderKind;
  folio: string;
  status: "issued" | "canceled";
  quoteId: string | null;
  quoteFolio: string | null;
  saleId: string | null;
  chargeStatus: ChargeStatus;
  indications: string | null;
  diagnosis: string | null;
  total: string;
  lines: OrderLineView[];
  createdAt: string;
  canceledAt: string | null;
}

/** Una línea ya resuelta: lo que el papel va a decir y a qué precio. */
interface LineaLista {
  id: string;
  productId: string | null;
  presentationId: string | null;
  labStudyId: string | null;
  diagnosticStudyId: string | null;
  description: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  dosage: string | null;
}

const INCLUDE = {
  lines: { orderBy: { lineNo: "asc" as const } },
  quote: { select: { folio: true, status: true, sale: { select: { id: true } } } },
} as const;
type OrderRow = Prisma.MedicalClinicOrderGetPayload<{ include: typeof INCLUDE }>;
type Tx = Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0];

/**
 * F9-CLINIC-14/15/23 — la orden médica y su cotización.
 *
 * ── Con venta: el MISMO folio ───────────────────────────────────────────
 *
 * Si el negocio vende ese tipo (F9-CLINIC-22), la orden nace pegada a una
 * cotización: toma el folio de la serie `COT` y la cotización lleva
 * `source_module/source_ref` apuntando a la orden; sus líneas de estudio son
 * CONCEPTOS con `source_ref` a la LÍNEA de la orden. La receta resuelve
 * precios con el mismo código del POS (`resolverLineasParaModulo`): el día
 * que la caja bloquee un lote vencido, la receta deja de cotizarlo.
 *
 * Los ids de la orden y de sus líneas se generan ANTES de insertar nada,
 * porque la cotización (que se inserta primero, para tener `quote_id`) ya
 * tiene que poder nombrarlos.
 *
 * ── Sin venta: serie ORM, sin cotización ────────────────────────────────
 *
 * La orden se registra para imprimirse en carta. La receta resuelve producto
 * y presentación (descripción y precio de referencia) SIN exigir stock: lo
 * que no se surte aquí no depende de este almacén.
 *
 * Todo en UNA transacción: si falla la última línea no queda folio gastado
 * ni cotización huérfana. Se resuelve todo antes de pedir el folio, para
 * que el lock de la serie dure lo menos posible.
 */
@Injectable()
export class MedicalOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly quotes: QuotesService,
    private readonly settings: SettingsService,
  ) {}

  async create(
    user: AuthUser,
    recordId: string,
    dto: CreateOrderDto,
    meta: RequestMeta,
  ): Promise<OrderView> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const expediente = await tx.medicalClinicRecord.findFirst({
        where: { id: recordId, tenantId: user.tenantId },
        select: { id: true, status: true, consultationDate: true },
      });
      if (expediente === null) {
        throw new NotFoundException({ message: "medical_clinic.record_not_found" });
      }
      // Cerrada o de otro día: tampoco se emiten órdenes (F9-CLINIC-26).
      const candado = medicalRecordLock(
        {
          status: expediente.status,
          consultationDate: expediente.consultationDate.toISOString().slice(0, 10),
        },
        await diaDelNegocio(tx, user.tenantId),
      );
      if (candado !== null) {
        throw new ConflictException({ message: `medical_clinic.record_${candado}` });
      }

      const config = await this.settings.leer(tx, user.tenantId);
      const seVende =
        dto.kind === "prescription"
          ? config.sellsMedications
          : dto.kind === "lab_order"
            ? config.sellsLabStudies
            : config.sellsDiagnosticStudies;

      const orderId = randomUUID();
      const lineas = await this.resolverLineas(tx, user, dto, seVende);

      let folio: string;
      let quoteId: string | null = null;
      if (seVende) {
        const warehouseId = await this.almacenDelMedico(tx, user);
        folio = await nextFolio(tx, user.tenantId, "quote", POS_FOLIO_PREFIXES.quote);
        const total = lineas.reduce(
          (acc, l) => acc.plus(l.unitPrice.times(l.quantity)),
          new Prisma.Decimal(0),
        );
        const cotizacion = await tx.quote.create({
          data: {
            tenantId: user.tenantId,
            folio,
            warehouseId,
            total,
            createdBy: user.userId,
            sourceModule: SOURCE_MODULE,
            sourceRef: orderId,
            lines: {
              create: lineas.map((l, i) => ({
                tenantId: user.tenantId,
                lineNo: i + 1,
                kind: l.productId !== null ? "product" : "concept",
                ...(l.productId !== null && { productId: l.productId }),
                presentationId: l.presentationId,
                description: l.description,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                lineTotal: l.unitPrice.times(l.quantity),
                sourceModule: SOURCE_MODULE,
                sourceRef: l.id,
              })),
            },
          },
        });
        quoteId = cotizacion.id;
      } else {
        folio = await nextFolio(
          tx,
          user.tenantId,
          "medical_order",
          MEDICAL_CLINIC_FOLIO_PREFIXES.order,
        );
      }

      await tx.medicalClinicOrder.create({
        data: {
          id: orderId,
          tenantId: user.tenantId,
          recordId,
          kind: dto.kind,
          folio,
          quoteId,
          indications: dto.indications ?? null,
          diagnosis: dto.diagnosis ?? null,
          createdBy: user.userId,
        },
      });
      await tx.medicalClinicOrderLine.createMany({
        data: lineas.map((l, i) => ({
          id: l.id,
          tenantId: user.tenantId,
          orderId,
          orderKind: dto.kind,
          lineNo: i + 1,
          productId: l.productId,
          presentationId: l.presentationId,
          labStudyId: l.labStudyId,
          diagnosticStudyId: l.diagnosticStudyId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          dosage: l.dosage,
        })),
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "medical_clinic.order.create",
        resourceType: "medical_order",
        resourceId: orderId,
        after: { folio, kind: dto.kind, quoteId, lines: lineas.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cargar(tx, user.tenantId, orderId);
    });
  }

  async list(user: AuthUser, recordId: string): Promise<OrderView[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const filas = await tx.medicalClinicOrder.findMany({
        where: { tenantId: user.tenantId, recordId },
        include: INCLUDE,
        orderBy: [{ createdAt: "desc" }],
      });
      return filas.map(toView);
    });
  }

  async get(user: AuthUser, id: string): Promise<OrderView> {
    return this.prisma.withTenantContext(user.tenantId, (tx) => this.cargar(tx, user.tenantId, id));
  }

  /**
   * Cancelar: cobrada → 409 (lo que hay que deshacer es la venta); con
   * cotización abierta, las dos se cancelan en la misma tx; sin cotización,
   * solo la orden. Lock lógico con `updateMany … WHERE status='issued'`.
   */
  async cancel(user: AuthUser, id: string, meta: RequestMeta): Promise<OrderView> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const orden = await tx.medicalClinicOrder.findFirst({
        where: { id, tenantId: user.tenantId },
        include: INCLUDE,
      });
      if (orden === null) {
        throw new NotFoundException({ message: "medical_clinic.order_not_found" });
      }
      if (orden.status === "canceled") {
        throw new ConflictException({ message: "medical_clinic.order_already_canceled" });
      }
      if (orden.quote?.status === "loaded") {
        throw new ConflictException({ message: "medical_clinic.order_already_charged" });
      }
      const ahora = new Date();
      const canceladas = await tx.medicalClinicOrder.updateMany({
        where: { id, tenantId: user.tenantId, status: "issued" },
        data: { status: "canceled", canceledAt: ahora, canceledBy: user.userId },
      });
      if (canceladas.count !== 1) {
        throw new ConflictException({ message: "medical_clinic.order_already_canceled" });
      }
      if (orden.quoteId !== null) {
        await tx.quote.updateMany({
          where: { id: orden.quoteId, tenantId: user.tenantId, status: "open" },
          data: { status: "canceled", canceledAt: ahora, canceledBy: user.userId },
        });
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "medical_clinic.order.cancel",
        resourceType: "medical_order",
        resourceId: id,
        before: { status: "issued", quoteId: orden.quoteId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cargar(tx, user.tenantId, id);
    });
  }

  private async cargar(tx: Tx, tenantId: string, id: string): Promise<OrderView> {
    const fila = await tx.medicalClinicOrder.findFirst({
      where: { id, tenantId },
      include: INCLUDE,
    });
    if (fila === null) {
      throw new NotFoundException({ message: "medical_clinic.order_not_found" });
    }
    return toView(fila);
  }

  private async resolverLineas(
    tx: Tx,
    user: AuthUser,
    dto: CreateOrderDto,
    seVende: boolean,
  ): Promise<LineaLista[]> {
    if (dto.kind === "prescription") {
      const recetadas = dto.lines.filter((l): l is PrescriptionLineDto => "productId" in l);
      if (seVende) {
        // El MISMO código del POS: hereda vencidos y presentaciones no vendibles.
        const warehouseId = await this.almacenDelMedico(tx, user);
        const resueltas = await this.quotes.resolverLineasParaModulo(
          tx,
          user,
          warehouseId,
          recetadas.map((l) => ({
            productId: l.productId,
            ...(l.presentationId !== undefined && { presentationId: l.presentationId }),
            quantity: l.quantity,
          })),
        );
        return resueltas.map((r, i) => ({
          id: randomUUID(),
          productId: r.productId,
          presentationId: r.presentationId,
          labStudyId: null,
          diagnosticStudyId: null,
          description: r.description,
          quantity: new Prisma.Decimal(recetadas[i]?.quantity ?? 0),
          unitPrice: r.unitPrice,
          dosage: recetadas[i]?.dosage ?? null,
        }));
      }
      // Sin venta: descripción y precio de REFERENCIA, sin exigir stock.
      const lineas: LineaLista[] = [];
      for (const l of recetadas) {
        const producto = await tx.product.findFirst({
          where: { id: l.productId, tenantId: user.tenantId, isActive: true },
          select: {
            name: true,
            presentations: {
              where: { isActive: true },
              select: { id: true, name: true, price: true, isDefaultSale: true },
              orderBy: { factor: "asc" },
            },
          },
        });
        if (producto === null) {
          throw new UnprocessableEntityException({ message: "pos.product_not_sellable" });
        }
        const presentacion =
          l.presentationId !== undefined
            ? producto.presentations.find((p) => p.id === l.presentationId)
            : (producto.presentations.find((p) => p.isDefaultSale) ?? producto.presentations[0]);
        if (presentacion === undefined) {
          throw new UnprocessableEntityException({ message: "pos.presentation_not_sellable" });
        }
        lineas.push({
          id: randomUUID(),
          productId: l.productId,
          presentationId: presentacion.id,
          labStudyId: null,
          diagnosticStudyId: null,
          description: `${producto.name} — ${presentacion.name}`,
          quantity: new Prisma.Decimal(l.quantity),
          unitPrice: presentacion.price ?? new Prisma.Decimal(0),
          dosage: l.dosage ?? null,
        });
      }
      return lineas;
    }

    const esLab = dto.kind === "lab_order";
    const ids = dto.lines.map((l) =>
      esLab
        ? (l as { labStudyId: string }).labStudyId
        : (l as { diagnosticStudyId: string }).diagnosticStudyId,
    );
    const where = { where: { id: { in: ids }, tenantId: user.tenantId, isActive: true } };
    const estudios = esLab
      ? await tx.medicalClinicLabStudy.findMany(where)
      : await tx.medicalClinicDiagnosticStudy.findMany(where);
    const porId = new Map(estudios.map((e) => [e.id, e]));
    return dto.lines.map((l) => {
      const id = esLab
        ? (l as { labStudyId: string }).labStudyId
        : (l as { diagnosticStudyId: string }).diagnosticStudyId;
      const estudio = porId.get(id);
      if (estudio === undefined) {
        throw new UnprocessableEntityException({ message: "medical_clinic.study_not_available" });
      }
      return {
        id: randomUUID(),
        productId: null,
        presentationId: null,
        labStudyId: esLab ? id : null,
        diagnosticStudyId: esLab ? null : id,
        description: estudio.name,
        quantity: new Prisma.Decimal((l as { quantity?: number }).quantity ?? 1),
        unitPrice: estudio.price ?? new Prisma.Decimal(0),
        dosage: null,
      };
    });
  }

  private async almacenDelMedico(tx: Tx, user: AuthUser): Promise<string> {
    const fila = await tx.user.findFirst({
      where: { id: user.userId, tenantId: user.tenantId },
      select: { defaultWarehouseId: true },
    });
    if (fila?.defaultWarehouseId == null) {
      throw new NotFoundException({ message: "medical_clinic.no_default_warehouse" });
    }
    return fila.defaultWarehouseId;
  }
}

export function toView(fila: OrderRow): OrderView {
  const total = fila.lines.reduce(
    (acc, l) => acc.plus(l.unitPrice.times(l.quantity)),
    new Prisma.Decimal(0),
  );
  return {
    id: fila.id,
    recordId: fila.recordId,
    kind: fila.kind as MedicalOrderKind,
    folio: fila.folio,
    status: fila.status === "canceled" ? "canceled" : "issued",
    quoteId: fila.quoteId,
    quoteFolio: fila.quote?.folio ?? null,
    saleId: fila.quote?.sale?.id ?? null,
    chargeStatus:
      fila.quoteId === null
        ? "not_for_sale"
        : fila.quote?.status === "loaded"
          ? "charged"
          : "pending",
    indications: fila.indications,
    diagnosis: fila.diagnosis,
    total: total.toString(),
    lines: fila.lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      productId: l.productId,
      presentationId: l.presentationId,
      labStudyId: l.labStudyId,
      diagnosticStudyId: l.diagnosticStudyId,
      description: l.description,
      quantity: l.quantity.toString(),
      unitPrice: l.unitPrice.toString(),
      dosage: l.dosage,
    })),
    createdAt: fila.createdAt.toISOString(),
    canceledAt: fila.canceledAt?.toISOString() ?? null,
  };
}
