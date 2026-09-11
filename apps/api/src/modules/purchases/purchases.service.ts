import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  DEFAULT_PURCHASE_TAX_MODE,
  FOLIO_PREFIXES,
  localCalendarDate,
  PURCHASE_FOLIO_PREFIXES,
  type PurchaseTaxMode,
  totalMismatch,
} from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { DocumentsService } from "../inventory/documents.service";
import { nextFolio } from "../inventory/folio";
import {
  assertActiveWarehouse,
  assertWarehouseInScope,
} from "../inventory/warehouse-scope.helpers";
import type {
  CancelPurchaseDto,
  CreatePurchaseDto,
  ListPurchasesQuery,
  UpdatePurchaseDto,
  UpdateReceptionDto,
} from "./dto/purchase.dto";
import { PurchaseLinesService } from "./purchase-lines.service";

/** El módulo que el inventario guarda como ORIGEN de una entrada nacida de una compra. */
export const PURCHASE_SOURCE_MODULE = "purchases";

export interface PurchaseLineView {
  id: string;
  lineNo: number;
  productId: string;
  productSku: string;
  presentationId: string | null;
  presentationName: string | null;
  quantity: string | null;
  unitCost: string | null;
  unitCostNet: string | null;
  discount: string;
  taxGroupCode: string | null;
  taxAmount: string;
  lineTotal: string;
  lotCode: string | null;
  expiresAt: string | null;
  description: string;
}

export interface PurchaseChargeView {
  id: string;
  lineNo: number;
  description: string;
  amount: string;
  taxGroupId: string | null;
  taxGroupCode: string | null;
  taxAmount: string;
  lineTotal: string;
}

export interface PurchaseRow {
  id: string;
  folio: string;
  status: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  purchaseDate: string;
  receivedDate: string | null;
  supplierInvoice: string | null;
  declaredTotal: string | null;
  subtotal: string;
  discount: string;
  taxTotal: string;
  total: string;
  extraChargesTotal: string;
  taxMode: PurchaseTaxMode;
  notes: string | null;
  /** DERIVADO: el papel contra la suma de las líneas. Avisa, nunca bloquea. */
  mismatch: boolean;
  difference: string | null;
  lineCount: number;
  createdAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

/** El catálogo de lo que YA está en la compra: para el selector y el aviso de lote. */
export interface PurchaseProductView {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  tracksLots: boolean;
  presentations: { id: string; name: string; factor: string; isPurchasable: boolean }[];
}

/** Una página del listado con el resumen del RANGO filtrado (sin anuladas). */
export interface PurchasesPage {
  rows: PurchaseRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: { count: number; total: string; mismatchCount: number };
}

export interface PurchaseDetail extends PurchaseRow {
  lines: PurchaseLineView[];
  products: PurchaseProductView[];
  charges: PurchaseChargeView[];
  taxes: { code: string; name: string; rate: string; base: string; amount: string }[];
  /** La entrada de inventario VIVA que nació de esta compra, si ya se pidió. */
  entry: { id: string; folio: string; status: string } | null;
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
      // El producto viene con sus presentaciones ACTIVAS en la MISMA consulta
      // (molde: el detalle del documento de inventario): la pantalla necesita
      // el selector de presentación y el aviso de lote, y si cada fila fuera a
      // buscarlos, una factura de cuarenta líneas haría cuarenta viajes desde
      // el navegador.
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          baseUnit: true,
          tracksLots: true,
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
  charges: { orderBy: { lineNo: "asc" } },
  taxes: { orderBy: { sortOrder: "asc" } },
} as const;

type FilaConRelaciones = Prisma.PurchaseGetPayload<{ include: typeof INCLUDE }>;
type FilaDetallada = Prisma.PurchaseGetPayload<{ include: typeof DETALLE }>;

/**
 * F9-PURCH-05 — la COMPRA: la factura del proveedor, capturada.
 *
 * La compra **transporta**: guarda lo que el proveedor facturó y, al
 * confirmarse, ofrece un borrador de entrada con sus líneas precargadas. La
 * que exige lote, caducidad y ubicación —y la que mueve el stock— es la
 * entrada. Por eso acá el borrador es laxo (una línea a medio capturar es un
 * estado normal) y el rigor vive en el `confirm`.
 *
 * Como toda captura larga, la cabecera es autoguardado: `updateHeader` no
 * valida reglas de completitud, solo que la compra siga siendo un borrador.
 */
@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly documents: DocumentsService,
    @Inject(forwardRef(() => PurchaseLinesService))
    private readonly lines: PurchaseLinesService,
  ) {}

  async createDraft(
    user: AuthUser,
    scope: UserScope,
    input: CreatePurchaseDto,
    meta: RequestMeta,
  ): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const warehouseId = input.warehouseId ?? (await this.almacenAsignado(tx, user));
      assertWarehouseInScope(scope, warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, warehouseId);
      await this.assertProveedor(tx, user.tenantId, input.supplierId);

      // El folio se toma acá, en una transacción CORTA: no hay ledger que
      // asentar, así que el lock de la serie dura milisegundos. El `confirm`
      // no pide folio — ya lo tiene desde que nació.
      const folio = await nextFolio(
        tx,
        user.tenantId,
        "purchase",
        PURCHASE_FOLIO_PREFIXES.purchase,
      );
      await this.assertFechasNoFuturas(tx, user.tenantId, { purchaseDate: input.purchaseDate });
      const creada = await tx.purchase.create({
        data: {
          tenantId: user.tenantId,
          folio,
          supplierId: input.supplierId,
          warehouseId,
          purchaseDate: new Date(input.purchaseDate),
          taxMode: DEFAULT_PURCHASE_TAX_MODE,
          createdBy: user.userId,
        },
        include: DETALLE,
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchases.create",
        resourceType: "purchase",
        resourceId: creada.id,
        after: { folio, supplierId: input.supplierId },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.detailFrom(creada, null);
    });
  }

  async list(user: AuthUser, scope: UserScope, query: ListPurchasesQuery): Promise<PurchasesPage> {
    const where = this.where(user, scope, query);
    // El resumen es del FILTRO, no de la página: quien busca «septiembre, este
    // proveedor» quiere saber cuánto compró en septiembre, no cuánto suman las
    // veinte filas que le tocaron. Y excluye las anuladas: un papel anulado no
    // se compró. Si el usuario filtra justamente `status=canceled`, el resumen
    // queda en cero — que es la verdad, no un error.
    const vivas: Prisma.PurchaseWhereInput = { AND: [where, { status: { not: "canceled" } }] };
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows, agregado, declaradas] = await Promise.all([
        tx.purchase.count({ where }),
        tx.purchase.findMany({
          where,
          include: INCLUDE,
          // Del papel más reciente al más viejo; desempate por id.
          orderBy: [{ purchaseDate: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.purchase.aggregate({ where: vivas, _count: { _all: true }, _sum: { total: true } }),
        // El descuadre compara DOS columnas y eso Prisma no lo sabe hacer; en
        // vez de rehacer el `where` en SQL crudo (que sería la copia que un día
        // se desincroniza del filtro de arriba), se traen solo las compras con
        // total declarado —las únicas que pueden descuadrar— y las cuenta la
        // MISMA función que usan la fila, el detalle y el PDF.
        tx.purchase.findMany({
          where: { AND: [vivas, { declaredTotal: { not: null } }] },
          select: { declaredTotal: true, total: true },
        }),
      ]);
      const mismatchCount = declaradas.filter(
        (c) => totalMismatch(c.declaredTotal?.toString() ?? null, c.total.toString()).mismatch,
      ).length;
      return {
        rows: rows.map(aFila),
        total,
        page: query.page,
        pageSize: query.pageSize,
        summary: {
          count: agregado._count._all,
          total: (agregado._sum.total ?? new Prisma.Decimal(0)).toString(),
          mismatchCount,
        },
      };
    });
  }

  async detail(user: AuthUser, id: string): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const compra = await this.buscar(tx, user.tenantId, id);
      return this.detailFrom(compra, await this.entradaViva(tx, user.tenantId, id));
    });
  }

  /**
   * Autoguardado de la cabecera del BORRADOR. No valida completitud: elegir
   * proveedor y todavía no tener líneas es un estado normal mientras se
   * captura. Lo que valida duro es el `confirm`.
   */
  async updateHeader(
    user: AuthUser,
    scope: UserScope,
    id: string,
    input: UpdatePurchaseDto,
    meta: RequestMeta,
  ): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await this.assertDraft(tx, user.tenantId, id);
      if (input.warehouseId !== undefined) {
        assertWarehouseInScope(scope, input.warehouseId);
        await assertActiveWarehouse(tx, user.tenantId, input.warehouseId);
      }
      if (input.supplierId !== undefined) {
        await this.assertProveedor(tx, user.tenantId, input.supplierId);
      }
      await this.assertFechasNoFuturas(tx, user.tenantId, input);
      const data: Prisma.PurchaseUncheckedUpdateInput = {
        ...(input.supplierId !== undefined && { supplierId: input.supplierId }),
        ...(input.warehouseId !== undefined && { warehouseId: input.warehouseId }),
        ...(input.purchaseDate !== undefined && { purchaseDate: new Date(input.purchaseDate) }),
        ...(input.receivedDate !== undefined && {
          receivedDate: input.receivedDate === null ? null : new Date(input.receivedDate),
        }),
        ...(input.supplierInvoice !== undefined && { supplierInvoice: input.supplierInvoice }),
        ...(input.declaredTotal !== undefined && {
          declaredTotal:
            input.declaredTotal === null ? null : new Prisma.Decimal(input.declaredTotal),
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
      };
      // Cambiar el MODO fiscal cambia la aritmética de todas las líneas: hay
      // que recalcular, no solo guardar el campo. Lo hace el service de
      // líneas, que es el dueño del sumador.
      if (input.taxMode !== undefined && input.taxMode !== actual.taxMode) {
        data.taxMode = input.taxMode;
      }
      await tx.purchase.update({ where: { id }, data });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchases.update",
        resourceType: "purchase",
        resourceId: id,
        after: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const refrescada = await this.buscar(tx, user.tenantId, id);
      return this.detailFrom(refrescada, await this.entradaViva(tx, user.tenantId, id));
    });
  }

  /**
   * Lo único que se edita en una compra CONFIRMADA: cuándo llegó la mercancía,
   * el número de factura definitivo y las notas. Nada que mueva dinero — eso
   * ya se selló y su PDF se imprimió.
   */
  async updateReception(
    user: AuthUser,
    id: string,
    input: UpdateReceptionDto,
    meta: RequestMeta,
  ): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await this.buscar(tx, user.tenantId, id);
      if (actual.status !== "confirmed") {
        throw new ConflictException({ message: "purchases.not_confirmed" });
      }
      await this.assertFechasNoFuturas(tx, user.tenantId, input);
      await tx.purchase.update({
        where: { id },
        data: {
          ...(input.receivedDate !== undefined && {
            receivedDate: input.receivedDate === null ? null : new Date(input.receivedDate),
          }),
          ...(input.supplierInvoice !== undefined && { supplierInvoice: input.supplierInvoice }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchases.reception",
        resourceType: "purchase",
        resourceId: id,
        after: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const refrescada = await this.buscar(tx, user.tenantId, id);
      return this.detailFrom(refrescada, await this.entradaViva(tx, user.tenantId, id));
    });
  }

  /**
   * F9-PURCH-07 — sella la compra.
   *
   * Revalida lo que el borrador dejaba pasar (una línea sin cantidad o sin
   * costo es normal mientras se captura, imposible al confirmar), recalcula
   * con el mismo sumador y **materializa `unit_cost_net`** — el número que
   * pisará el catálogo cuando la entrada se confirme.
   *
   * ⚠ El orden importa y lo fija el trigger: todo lo que se escribe en las
   * hijas va ANTES de mover `status`. Al revés, la propia transacción vería
   * la compra ya confirmada y Postgres cortaría con `42501`.
   */
  async confirm(user: AuthUser, id: string, meta: RequestMeta): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const compra = await this.assertDraft(tx, user.tenantId, id);
      if (compra.lines.length === 0) {
        throw new UnprocessableEntityException({ message: "purchases.needs_lines" });
      }
      for (const linea of compra.lines) {
        if (linea.quantity === null || linea.quantity.lessThanOrEqualTo(0)) {
          throw new UnprocessableEntityException({
            message: "purchases.line_needs_quantity",
            args: { field: `lines.${linea.lineNo}.quantity` },
          });
        }
        if (linea.unitCost === null) {
          // El costo no es un adorno: es lo que va a pisar el costo del
          // catálogo y alimentar el promedio ponderado. Sin él, la entrada
          // entraría mercancía sin saber cuánto costó.
          throw new UnprocessableEntityException({
            message: "purchases.line_needs_cost",
            args: { field: `lines.${linea.lineNo}.unitCost` },
          });
        }
      }

      // Primero el contenido (totales, impuestos y `unit_cost_net`)…
      await this.lines.recomponer(tx, user.tenantId, id, { materializarCosto: true });
      // …y recién entonces el sello.
      await tx.purchase.update({
        where: { id },
        data: { status: "confirmed", confirmedAt: new Date(), confirmedBy: user.userId },
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchases.confirm",
        resourceType: "purchase",
        resourceId: id,
        after: { folio: compra.folio, lines: compra.lines.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const sellada = await this.buscar(tx, user.tenantId, id);
      return this.detailFrom(sellada, await this.entradaViva(tx, user.tenantId, id));
    });
  }

  /**
   * F9-PURCH-07 — anula la compra, y con ella el borrador de entrada que haya
   * abierto: en el MISMO commit (`cancelDraftWithinTx`), o quedaría una
   * entrada huérfana apuntando a una compra anulada.
   *
   * Si esa entrada ya se CONFIRMÓ, la mercancía entró y el stock se movió:
   * anular la compra no lo desharía y dejaría el inventario contando algo que
   * el papel dice que no pasó. Es 409 — la corrección es una salida.
   */
  async cancel(
    user: AuthUser,
    id: string,
    input: CancelPurchaseDto,
    meta: RequestMeta,
  ): Promise<PurchaseDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const compra = await this.buscar(tx, user.tenantId, id);
      const entrada = await this.entradaViva(tx, user.tenantId, id);
      if (entrada !== null && entrada.status === "confirmed") {
        throw new ConflictException({ message: "purchases.entry_already_confirmed" });
      }

      const tomadas = await tx.purchase.updateMany({
        where: { id, tenantId: user.tenantId, status: { in: ["draft", "confirmed"] } },
        data: {
          status: "canceled",
          canceledAt: new Date(),
          canceledBy: user.userId,
          cancelReason: input.reason,
        },
      });
      if (tomadas.count !== 1) {
        throw new ConflictException({ message: "purchases.already_canceled" });
      }
      if (entrada !== null) {
        await this.documents.cancelDraftWithinTx(
          tx,
          user.tenantId,
          user.userId,
          entrada.id,
          `Compra ${compra.folio} anulada: ${input.reason}`,
        );
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "purchases.cancel",
        resourceType: "purchase",
        resourceId: id,
        before: { status: compra.status, total: compra.total.toString() },
        after: { status: "canceled", reason: input.reason, entry: entrada?.folio ?? null },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      const anulada = await this.buscar(tx, user.tenantId, id);
      return this.detailFrom(anulada, null);
    });
  }

  /**
   * F9-PURCH-08 — EL PUENTE: el borrador de entrada con las líneas de la
   * compra precargadas (molde: `TransfersService.createReceiptDraft`).
   *
   * Lo que cruza y lo que no:
   *  · la CANTIDAD va en la presentación capturada, tal cual — convertirla a
   *    base la multiplicaría por el factor (3 cajas de 12 llegarían como 36);
   *  · el costo que viaja es `unit_cost_net`, nunca el bruto: pisa
   *    `product_presentations.cost` y un precio con IVA inflaría el margen;
   *  · lote, caducidad y la ubicación de referencia del producto viajan para
   *    que quien recibe pueda cotejarlas contra la caja física;
   *  · **no se confirma**: la entrada se revisa y se cierra a mano, que es
   *    donde el inventario exige lo que exige.
   *
   * Es idempotente por la BASE (índice único parcial sobre el par vivo), no
   * por este `findFirst`: dos pestañas llegan las dos hasta acá.
   */
  async createEntryDraft(
    user: AuthUser,
    scope: UserScope,
    id: string,
  ): Promise<{ id: string; folio: string; status: string }> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const existente = await this.entradaViva(tx, user.tenantId, id);
      if (existente !== null) {
        return existente;
      }
      const compra = await this.buscar(tx, user.tenantId, id);
      if (compra.status !== "confirmed") {
        throw new ConflictException({ message: "purchases.not_confirmed" });
      }
      assertWarehouseInScope(scope, compra.warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, compra.warehouseId);

      // La ubicación de REFERENCIA de cada producto: es el valor inicial que
      // la pantalla de la entrada ofrece, igual que en una entrada a mano.
      const productos = await tx.product.findMany({
        where: { tenantId: user.tenantId, id: { in: compra.lines.map((l) => l.productId) } },
        select: { id: true, location: true, tracksLots: true },
      });
      const ubicacion = new Map(productos.map((p) => [p.id, p.location]));
      // Un lote solo cruza si el producto TODAVÍA se controla por lote: las
      // líneas rechazan el lote en un producto sin control desde el 2026-09-11,
      // pero una compra anterior a eso —o un producto al que le apagaron el
      // control después de confirmarla— lo trae, y la entrada lo rechazaría al
      // confirmar. El costo y la cantidad viajan igual; el lote se queda en el
      // papel de la compra, que es donde el proveedor lo escribió.
      const controlaLote = new Map(productos.map((p) => [p.id, p.tracksLots]));

      const folio = await nextFolio(tx, user.tenantId, "entry", FOLIO_PREFIXES.entry);
      const entrada = await tx.inventoryDocument.create({
        data: {
          tenantId: user.tenantId,
          folio,
          type: "entry",
          warehouseId: compra.warehouseId,
          // «Factura de compra» ya existía en el catálogo de motivos y exige
          // referencia y costo: es exactamente esta operación.
          reasonCode: "invoice",
          reference: compra.supplierInvoice ?? compra.folio,
          // Solo el folio, SIN prefijo en prosa: la nota la lee un negocio que
          // puede estar en inglés, y el aviso del web ya dice «nació de la
          // compra {{folio}}». Un `Compra COM-…` acá se traduciría solo en
          // español y se leería duplicado allá.
          reasonNote: compra.folio,
          sourceModule: PURCHASE_SOURCE_MODULE,
          sourceRef: compra.id,
          createdBy: user.userId,
          lines: {
            create: compra.lines.map((linea, index) => ({
              tenantId: user.tenantId,
              lineNo: index + 1,
              productId: linea.productId,
              presentationId: linea.presentationId,
              quantity: linea.quantity,
              unitCost: linea.unitCostNet,
              lotCode: controlaLote.get(linea.productId) === true ? linea.lotCode : null,
              expiresAt: controlaLote.get(linea.productId) === true ? linea.expiresAt : null,
              location: ubicacion.get(linea.productId) ?? null,
            })),
          },
        },
        select: { id: true, folio: true, status: true },
      });
      return entrada;
    });
  }

  /** El `where` compartido por listado, conteo y resumen. */
  where(user: AuthUser, scope: UserScope, query: ListPurchasesQuery): Prisma.PurchaseWhereInput {
    const texto = query.query?.trim();
    return {
      tenantId: user.tenantId,
      ...(scope.warehouseIds !== "all" && { warehouseId: { in: [...scope.warehouseIds] } }),
      ...(query.warehouseId !== undefined && { warehouseId: query.warehouseId }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.supplierId !== undefined && { supplierId: query.supplierId }),
      ...(query.folio !== undefined && {
        folio: { contains: query.folio, mode: "insensitive" as const },
      }),
      // DATE con DATE: `purchase_date` es un día del calendario y un
      // `YYYY-MM-DD` parseado en UTC es exactamente ese día. Con
      // `startOfDayUtc` el rango se correría un día en cualquier negocio al
      // oeste de Greenwich.
      ...((query.from !== undefined || query.to !== undefined) && {
        purchaseDate: {
          ...(query.from !== undefined && { gte: new Date(query.from) }),
          ...(query.to !== undefined && { lte: new Date(query.to) }),
        },
      }),
      ...(texto
        ? {
            OR: [
              { folio: { contains: texto, mode: "insensitive" as const } },
              { supplierInvoice: { contains: texto, mode: "insensitive" as const } },
              { notes: { contains: texto, mode: "insensitive" as const } },
              { supplier: { name: { contains: texto, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
  }

  /** La compra, o 404. `tenantId` en el WHERE además de la RLS. */
  async buscar(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const compra = await tx.purchase.findFirst({ where: { id, tenantId }, include: DETALLE });
    if (compra === null) {
      throw new NotFoundException({ message: "purchases.not_found" });
    }
    return compra;
  }

  /** La compra, si sigue siendo un borrador. 409 en cuanto se selló. */
  async assertDraft(tx: Prisma.TransactionClient, tenantId: string, id: string) {
    const compra = await this.buscar(tx, tenantId, id);
    if (compra.status !== "draft") {
      throw new ConflictException({ message: "purchases.not_draft" });
    }
    return compra;
  }

  /**
   * La entrada de inventario VIVA de esta compra. Anulada no cuenta: es
   * historia, no el documento con el que se recibió — y por eso se puede
   * pedir otra (el índice único lleva `status <> 'canceled'`).
   */
  async entradaViva(tx: Prisma.TransactionClient, tenantId: string, purchaseId: string) {
    const entrada = await tx.inventoryDocument.findFirst({
      where: {
        tenantId,
        sourceModule: PURCHASE_SOURCE_MODULE,
        sourceRef: purchaseId,
        status: { not: "canceled" },
      },
      select: { id: true, folio: true, status: true },
    });
    return entrada;
  }

  /** El detalle público a partir de la fila ya leída: lo comparten este service y el de líneas. */
  detailFrom(
    compra: FilaDetallada,
    entry: { id: string; folio: string; status: string } | null,
  ): PurchaseDetail {
    return {
      ...aFila(compra),
      lines: compra.lines.map((l) => ({
        id: l.id,
        lineNo: l.lineNo,
        productId: l.productId,
        productSku: l.product.sku,
        presentationId: l.presentationId,
        presentationName: l.presentation?.name ?? null,
        quantity: l.quantity?.toString() ?? null,
        unitCost: l.unitCost?.toString() ?? null,
        unitCostNet: l.unitCostNet?.toString() ?? null,
        discount: l.discount.toString(),
        taxGroupCode: l.taxGroupCode,
        taxAmount: l.taxAmount.toString(),
        lineTotal: l.lineTotal.toString(),
        lotCode: l.lotCode,
        expiresAt: fechaIso(l.expiresAt),
        description: l.description,
      })),
      // Únicos por producto: dos líneas del mismo artículo no repiten su catálogo.
      products: [...new Map(compra.lines.map((l) => [l.productId, l.product])).values()].map(
        (p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          baseUnit: p.baseUnit,
          tracksLots: p.tracksLots,
          presentations: p.presentations.map((pr) => ({
            id: pr.id,
            name: pr.name,
            // Como toda cantidad del API: texto decimal, no number.
            factor: pr.factor.toString(),
            isPurchasable: pr.isPurchasable,
          })),
        }),
      ),
      charges: compra.charges.map((c) => ({
        id: c.id,
        lineNo: c.lineNo,
        description: c.description,
        amount: c.amount.toString(),
        taxGroupId: c.taxGroupId,
        taxGroupCode: c.taxGroupCode,
        taxAmount: c.taxAmount.toString(),
        lineTotal: c.lineTotal.toString(),
      })),
      taxes: compra.taxes.map((t) => ({
        code: t.code,
        name: t.name,
        rate: t.rate.toString(),
        base: t.base.toString(),
        amount: t.amount.toString(),
      })),
      entry,
    };
  }

  /**
   * Ni la factura ni la recepción pueden ser de MAÑANA (Carlos, 2026-09-11):
   * una compra es un papel que ya llegó, y una fecha futura corre el resumen
   * del rango y el costo promedio a un mes que todavía no existe. El «hoy» es
   * el del calendario del NEGOCIO, no el UTC del servidor: a las 11 de la
   * noche en Ciudad de México, «hoy» en UTC ya es mañana y la factura del día
   * rebotaría sin razón.
   */
  private async assertFechasNoFuturas(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fechas: { purchaseDate?: string; receivedDate?: string | null },
  ): Promise<void> {
    const candidatas: [string, string][] = [];
    if (typeof fechas.purchaseDate === "string") {
      candidatas.push(["purchaseDate", fechas.purchaseDate]);
    }
    if (typeof fechas.receivedDate === "string") {
      candidatas.push(["receivedDate", fechas.receivedDate]);
    }
    if (candidatas.length === 0) return;
    const negocio = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const hoy = localCalendarDate(negocio?.timezone ?? "UTC", new Date());
    for (const [campo, fecha] of candidatas) {
      // ISO `YYYY-MM-DD`: el orden lexicográfico ES el cronológico.
      if (fecha > hoy) {
        throw new UnprocessableEntityException({
          message: "purchases.date_in_future",
          args: { field: campo },
        });
      }
    }
  }

  private async assertProveedor(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string,
  ): Promise<void> {
    const existe = await tx.supplier.count({ where: { id: supplierId, tenantId } });
    if (existe === 0) {
      throw new NotFoundException({ message: "purchases.supplier_not_found" });
    }
  }

  private async almacenAsignado(tx: Prisma.TransactionClient, user: AuthUser): Promise<string> {
    const fila = await tx.user.findFirst({
      where: { id: user.userId, tenantId: user.tenantId },
      select: { defaultWarehouseId: true },
    });
    if (fila?.defaultWarehouseId == null) {
      throw new ConflictException({ message: "purchases.warehouse_required" });
    }
    return fila.defaultWarehouseId;
  }
}

const fechaIso = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10);

function aFila(compra: FilaConRelaciones): PurchaseRow {
  const total = compra.total.toString();
  const declarado = compra.declaredTotal?.toString() ?? null;
  const { mismatch, difference } = totalMismatch(declarado, total);
  return {
    id: compra.id,
    folio: compra.folio,
    status: compra.status,
    supplierId: compra.supplierId,
    supplierName: compra.supplier.name,
    warehouseId: compra.warehouseId,
    warehouseName: compra.warehouse.name,
    purchaseDate: fechaIso(compra.purchaseDate) as string,
    receivedDate: fechaIso(compra.receivedDate),
    supplierInvoice: compra.supplierInvoice,
    declaredTotal: declarado,
    subtotal: compra.subtotal.toString(),
    discount: compra.discount.toString(),
    taxTotal: compra.taxTotal.toString(),
    total,
    extraChargesTotal: compra.extraChargesTotal.toString(),
    taxMode: compra.taxMode as PurchaseTaxMode,
    notes: compra.notes,
    mismatch,
    difference,
    lineCount: compra._count.lines,
    createdAt: compra.createdAt.toISOString(),
    confirmedAt: compra.confirmedAt?.toISOString() ?? null,
    canceledAt: compra.canceledAt?.toISOString() ?? null,
    cancelReason: compra.cancelReason,
  };
}
