import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { EXPENSE_FOLIO_PREFIXES, type TaxMode } from "@sellpoint/shared";
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
import { contextoFiscal, grupoDe } from "../pos/tax-resolver";
import { armarTotales, type GrupoResuelto } from "../pos/totals";
import type {
  CancelExpenseDto,
  CreateExpenseDto,
  ListExpensesQuery,
  PayExpenseDto,
  UpdateExpenseDto,
} from "./dto/expense.dto";

/** El snapshot de un componente de impuesto: la FORMA EXACTA de `sale_taxes`. */
export interface ExpenseTaxRate {
  code: string;
  name: string;
  rate: string;
  base: string;
  amount: string;
  sortOrder: number;
}

/** Lo que sale al cliente. El dinero viaja como texto decimal; las fechas DATE como `YYYY-MM-DD`. */
export interface ExpenseSummary {
  id: string;
  folio: string;
  warehouseId: string;
  warehouseName: string;
  expenseDate: string;
  categoryId: string;
  categoryName: string;
  supplierId: string | null;
  supplierName: string | null;
  beneficiary: string | null;
  description: string;
  reference: string | null;
  amount: string;
  discount: string;
  taxGroupCode: string | null;
  taxRates: ExpenseTaxRate[];
  taxAmount: string;
  total: string;
  taxMode: TaxMode;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  paidAt: string | null;
  dueDate: string | null;
  cashboxSessionId: string | null;
  accountRef: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  canceledAt: string | null;
  cancelReason: string | null;
}

const INCLUDE = {
  warehouse: { select: { name: true } },
  category: { select: { name: true } },
  supplier: { select: { name: true } },
} as const;

type ExpenseRow = Prisma.ExpenseGetPayload<{ include: typeof INCLUDE }>;

/** Los campos que MUEVEN dinero: en un gasto pagado no se tocan (corregir = anular y recargar). */
const CAMPOS_DE_DINERO = ["amount", "discount", "taxGroupId"] as const;

/**
 * F9-EXP-05/06 — el registro de gastos.
 *
 * Un gasto es UNA línea y sus totales salen de `armarTotales` con
 * `quantity: 1`: el mismo sumador que la venta y la cotización, con el modo
 * fiscal del negocio (`included`: el monto ya trae el impuesto; `excluded`:
 * se suma). El 422 del descuento mayor al monto se relanza con la clave de
 * este módulo. `tax_rates` guarda los componentes con la forma de
 * `sale_taxes`, para que el IVA acreditable de mañana no recalcule nada.
 *
 * El gasto en EFECTIVO puede salir del cajón de un turno abierto: se liga a
 * una sesión ELEGIBLE (abierta, del mismo almacén, en alcance) tomada con
 * `FOR UPDATE` para que un cierre simultáneo no la deje fuera del arqueo. La
 * caja lo resta del efectivo esperado (F9-EXP-09).
 *
 * Dos hechos ortogonales: `status` (existe o se anuló) y `payment_status`.
 * Pagado ⇒ los campos de dinero quedan inmutables; anular uno ligado a una
 * sesión CERRADA es 409 (libro cerrado: la corrección es un gasto de ajuste).
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    user: AuthUser,
    scope: UserScope,
    input: CreateExpenseDto,
    meta: RequestMeta,
  ): Promise<ExpenseSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const warehouseId = input.warehouseId ?? (await this.almacenAsignado(tx, user));
      assertWarehouseInScope(scope, warehouseId);
      await assertActiveWarehouse(tx, user.tenantId, warehouseId);
      await this.assertCategoriaActiva(tx, user.tenantId, input.categoryId);
      await this.assertProveedor(tx, user.tenantId, input.supplierId);

      const { totales, fiscal, grupo } = await this.totalizar(
        tx,
        user.tenantId,
        input.amount,
        input.discount,
        input.taxGroupId,
      );
      const pagado = input.paymentMethod !== undefined;
      if (pagado && input.cashboxSessionId !== undefined) {
        await this.assertSesionElegible(tx, user, scope, input.cashboxSessionId, warehouseId);
      }

      const folio = await nextFolio(tx, user.tenantId, "expense", EXPENSE_FOLIO_PREFIXES.expense);
      const creado = await tx.expense.create({
        data: {
          tenantId: user.tenantId,
          folio,
          warehouseId,
          expenseDate: new Date(input.expenseDate),
          categoryId: input.categoryId,
          supplierId: input.supplierId ?? null,
          beneficiary: input.beneficiary ?? null,
          description: input.description,
          reference: input.reference ?? null,
          amount: new Prisma.Decimal(input.amount),
          discount: new Prisma.Decimal(input.discount),
          taxGroupCode: grupo?.code ?? null,
          taxRates: snapshotDeTasas(totales.byComponent) as unknown as Prisma.InputJsonValue,
          taxAmount: totales.taxTotal,
          total: totales.total,
          taxMode: fiscal.mode,
          paymentStatus: pagado ? "paid" : "pending",
          paymentMethod: input.paymentMethod ?? null,
          paidAt: pagado ? (input.paidAt ? new Date(input.paidAt) : new Date()) : null,
          accountRef: input.accountRef ?? null,
          cashboxSessionId: pagado ? (input.cashboxSessionId ?? null) : null,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          notes: input.notes ?? null,
          createdBy: user.userId,
        },
        include: INCLUDE,
      });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "expenses.create",
        resourceType: "expense",
        resourceId: creado.id,
        after: { folio, total: creado.total.toString(), paymentStatus: creado.paymentStatus },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(creado);
    });
  }

  async get(user: AuthUser, id: string): Promise<ExpenseSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) =>
      toSummary(await this.buscar(tx, user, id)),
    );
  }

  async list(
    user: AuthUser,
    scope: UserScope,
    query: ListExpensesQuery,
  ): Promise<{ rows: ExpenseSummary[]; total: number; page: number; pageSize: number }> {
    const where = this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.expense.count({ where }),
        tx.expense.findMany({
          where,
          include: INCLUDE,
          // Del más reciente al más viejo; desempate por id.
          orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      return { rows: rows.map(toSummary), total, page: query.page, pageSize: query.pageSize };
    });
  }

  /** Sin paginar, para el export (pasa antes por `count` y el tope de filas). */
  async all(user: AuthUser, scope: UserScope, query: ListExpensesQuery): Promise<ExpenseSummary[]> {
    const where = this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, async (tx) =>
      (
        await tx.expense.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ expenseDate: "desc" }, { id: "desc" }],
        })
      ).map(toSummary),
    );
  }

  async count(user: AuthUser, scope: UserScope, query: ListExpensesQuery): Promise<number> {
    const where = this.where(user, scope, query);
    return this.prisma.withTenantContext(user.tenantId, (tx) => tx.expense.count({ where }));
  }

  /** El `where` compartido por listado, conteo, export y resumen. */
  where(user: AuthUser, scope: UserScope, query: ListExpensesQuery): Prisma.ExpenseWhereInput {
    const texto = query.query?.trim();
    return {
      tenantId: user.tenantId,
      ...(scope.warehouseIds !== "all" && { warehouseId: { in: [...scope.warehouseIds] } }),
      ...(query.warehouseId !== undefined && { warehouseId: query.warehouseId }),
      ...(query.status !== undefined && { status: query.status }),
      ...(query.paymentStatus !== undefined && { paymentStatus: query.paymentStatus }),
      ...(query.paymentMethod !== undefined && { paymentMethod: query.paymentMethod }),
      ...(query.categoryId !== undefined && { categoryId: query.categoryId }),
      ...(query.supplierId !== undefined && { supplierId: query.supplierId }),
      // DATE con DATE: `expense_date` es un día del calendario del negocio,
      // y un `YYYY-MM-DD` parseado en UTC es exactamente ese día.
      ...((query.from !== undefined || query.to !== undefined) && {
        expenseDate: {
          ...(query.from !== undefined && { gte: new Date(query.from) }),
          ...(query.to !== undefined && { lte: new Date(query.to) }),
        },
      }),
      ...(texto
        ? {
            OR: [
              { folio: { contains: texto, mode: "insensitive" as const } },
              { description: { contains: texto, mode: "insensitive" as const } },
              { reference: { contains: texto, mode: "insensitive" as const } },
              { beneficiary: { contains: texto, mode: "insensitive" as const } },
              { supplier: { name: { contains: texto, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
  }

  /**
   * Marca un gasto pendiente como pagado, ENTERO (sin pagos parciales). El
   * lock es lógico: `updateMany … WHERE payment_status='pending' AND
   * status='active'` con `count = 1`; dos clics simultáneos no pagan dos veces.
   */
  async pay(
    user: AuthUser,
    scope: UserScope,
    id: string,
    input: PayExpenseDto,
    meta: RequestMeta,
  ): Promise<ExpenseSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await this.buscar(tx, user, id);
      if (actual.status === "canceled") {
        throw new ConflictException({ message: "expenses.already_canceled" });
      }
      if (input.paymentMethod === "cash" && input.cashboxSessionId !== undefined) {
        await this.assertSesionElegible(
          tx,
          user,
          scope,
          input.cashboxSessionId,
          actual.warehouseId,
        );
      }
      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
      const tomados = await tx.expense.updateMany({
        where: { id, tenantId: user.tenantId, paymentStatus: "pending", status: "active" },
        data: {
          paymentStatus: "paid",
          paymentMethod: input.paymentMethod,
          paidAt,
          accountRef: input.accountRef ?? actual.accountRef,
          cashboxSessionId:
            input.paymentMethod === "cash" ? (input.cashboxSessionId ?? null) : null,
        },
      });
      if (tomados.count !== 1) {
        throw new ConflictException({ message: "expenses.already_paid" });
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "expenses.pay",
        resourceType: "expense",
        resourceId: id,
        before: { paymentStatus: "pending" },
        after: {
          paymentStatus: "paid",
          paymentMethod: input.paymentMethod,
          paidAt: paidAt.toISOString(),
          cashboxSessionId: input.cashboxSessionId ?? null,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(await this.buscar(tx, user, id));
    });
  }

  /**
   * Anula. Un gasto ligado a una sesión ya CERRADA no se anula: el arqueo de
   * ese turno es un libro cerrado, y la corrección es un gasto de ajuste.
   */
  async cancel(
    user: AuthUser,
    id: string,
    input: CancelExpenseDto,
    meta: RequestMeta,
  ): Promise<ExpenseSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await this.buscar(tx, user, id);
      if (actual.cashboxSessionId !== null) {
        const sesion = await tx.cashboxSession.findFirst({
          where: { id: actual.cashboxSessionId, tenantId: user.tenantId },
          select: { status: true },
        });
        if (sesion?.status === "closed") {
          throw new ConflictException({ message: "expenses.session_closed" });
        }
      }
      const ahora = new Date();
      const tomados = await tx.expense.updateMany({
        where: { id, tenantId: user.tenantId, status: "active" },
        data: {
          status: "canceled",
          canceledAt: ahora,
          canceledBy: user.userId,
          cancelReason: input.reason,
        },
      });
      if (tomados.count !== 1) {
        throw new ConflictException({ message: "expenses.already_canceled" });
      }
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "expenses.cancel",
        resourceType: "expense",
        resourceId: id,
        before: { status: "active", total: actual.total.toString() },
        after: { status: "canceled", reason: input.reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(await this.buscar(tx, user, id));
    });
  }

  /**
   * Edita. Pendiente: todo. Pagado: solo lo que NO mueve dinero (fecha,
   * categoría, a quién, descripción, referencia, cuenta, vencimiento, notas).
   * Anulado: nada.
   */
  async update(
    user: AuthUser,
    id: string,
    input: UpdateExpenseDto,
    meta: RequestMeta,
  ): Promise<ExpenseSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await this.buscar(tx, user, id);
      if (actual.status === "canceled") {
        throw new ConflictException({ message: "expenses.already_canceled" });
      }
      const mueveDinero = CAMPOS_DE_DINERO.some((campo) => input[campo] !== undefined);
      if (actual.paymentStatus === "paid" && mueveDinero) {
        throw new ConflictException({ message: "expenses.paid_immutable" });
      }
      if (input.categoryId !== undefined) {
        await this.assertCategoriaActiva(tx, user.tenantId, input.categoryId);
      }
      if (input.supplierId != null) {
        await this.assertProveedor(tx, user.tenantId, input.supplierId);
      }
      // A quién se le pagó es UNA respuesta: poner uno limpia al otro.
      const data: Prisma.ExpenseUncheckedUpdateInput = {
        ...(input.expenseDate !== undefined && { expenseDate: new Date(input.expenseDate) }),
        ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
        ...(input.supplierId !== undefined && {
          supplierId: input.supplierId,
          ...(input.supplierId !== null && { beneficiary: null }),
        }),
        ...(input.beneficiary !== undefined && {
          beneficiary: input.beneficiary,
          ...(input.beneficiary !== null && { supplierId: null }),
        }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.reference !== undefined && { reference: input.reference }),
        ...(input.accountRef !== undefined && { accountRef: input.accountRef }),
        ...(input.dueDate !== undefined && {
          dueDate: input.dueDate === null ? null : new Date(input.dueDate),
        }),
        ...(input.notes !== undefined && { notes: input.notes }),
      };
      if (mueveDinero) {
        const amount = input.amount ?? actual.amount.toNumber();
        const discount = input.discount ?? actual.discount.toNumber();
        // El grupo: el que viene, o el congelado (por código) si no se toca.
        const grupoIdActual = await this.grupoIdPorCodigo(tx, user.tenantId, actual.taxGroupCode);
        const taxGroupId =
          input.taxGroupId !== undefined ? input.taxGroupId : (grupoIdActual ?? null);
        const { totales, fiscal, grupo } = await this.totalizar(
          tx,
          user.tenantId,
          amount,
          discount,
          taxGroupId,
        );
        Object.assign(data, {
          amount: new Prisma.Decimal(amount),
          discount: new Prisma.Decimal(discount),
          taxGroupCode: grupo?.code ?? null,
          taxRates: snapshotDeTasas(totales.byComponent) as unknown as Prisma.InputJsonValue,
          taxAmount: totales.taxTotal,
          total: totales.total,
          taxMode: fiscal.mode,
        });
      }
      const despues = await tx.expense.update({ where: { id }, data, include: INCLUDE });
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "expenses.update",
        resourceType: "expense",
        resourceId: id,
        before: { total: actual.total.toString(), description: actual.description },
        after: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toSummary(despues);
    });
  }

  private async buscar(tx: Prisma.TransactionClient, user: AuthUser, id: string) {
    const fila = await tx.expense.findFirst({
      where: { id, tenantId: user.tenantId },
      include: INCLUDE,
    });
    if (fila === null) {
      throw new NotFoundException({ message: "expenses.not_found" });
    }
    return fila;
  }

  /** UNA línea por `armarTotales`; el 422 del descuento se relanza con la clave del módulo. */
  private async totalizar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    amount: number,
    discount: number,
    taxGroupId: string | null | undefined,
  ) {
    const fiscal = await contextoFiscal(tx, tenantId, [taxGroupId]);
    // `null` explícito = sin impuesto; ausente = el default del negocio.
    const grupo: GrupoResuelto | null = taxGroupId === null ? null : grupoDe(fiscal, taxGroupId);
    if (taxGroupId != null && grupo?.id !== taxGroupId) {
      throw new UnprocessableEntityException({ message: "catalogs.tax_group_unknown" });
    }
    try {
      const totales = armarTotales(
        [
          {
            unitPrice: new Prisma.Decimal(amount),
            quantity: new Prisma.Decimal(1),
            discount: new Prisma.Decimal(discount),
            grupo,
          },
        ],
        fiscal.mode,
      );
      return { totales, fiscal, grupo };
    } catch (error) {
      if (
        error instanceof UnprocessableEntityException &&
        (error.getResponse() as { message?: string }).message === "pos.line_discount_exceeds_line"
      ) {
        throw new UnprocessableEntityException({ message: "expenses.discount_exceeds_amount" });
      }
      throw error;
    }
  }

  private async grupoIdPorCodigo(
    tx: Prisma.TransactionClient,
    tenantId: string,
    code: string | null,
  ): Promise<string | null> {
    if (code === null) return null;
    const grupo = await tx.taxGroup.findFirst({ where: { tenantId, code }, select: { id: true } });
    return grupo?.id ?? null;
  }

  /**
   * La sesión ELEGIBLE para un gasto en efectivo: abierta, del mismo almacén
   * y en alcance. Tomada con `FOR UPDATE` para que un cierre que corra al
   * mismo tiempo la vea después de este gasto, no antes.
   */
  private async assertSesionElegible(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    scope: UserScope,
    sessionId: string,
    warehouseId: string,
  ): Promise<void> {
    const filas = await tx.$queryRaw<{ status: string; warehouse_id: string }[]>`
      SELECT status, warehouse_id FROM cashbox_sessions
       WHERE id = ${sessionId}::uuid AND tenant_id = ${user.tenantId}::uuid
       FOR UPDATE`;
    const sesion = filas[0];
    if (sesion === undefined || sesion.status !== "open" || sesion.warehouse_id !== warehouseId) {
      throw new ConflictException({ message: "expenses.session_not_open" });
    }
    assertWarehouseInScope(scope, sesion.warehouse_id);
  }

  private async assertCategoriaActiva(
    tx: Prisma.TransactionClient,
    tenantId: string,
    categoryId: string,
  ): Promise<void> {
    const categoria = await tx.expenseCategory.findFirst({
      where: { id: categoryId, tenantId },
      select: { isActive: true },
    });
    if (categoria === null) {
      throw new NotFoundException({ message: "expenses.category_not_found" });
    }
    if (!categoria.isActive) {
      throw new UnprocessableEntityException({ message: "expenses.category_inactive" });
    }
  }

  private async assertProveedor(
    tx: Prisma.TransactionClient,
    tenantId: string,
    supplierId: string | undefined,
  ): Promise<void> {
    if (supplierId === undefined) return;
    const existe = await tx.supplier.count({ where: { id: supplierId, tenantId } });
    if (existe === 0) {
      throw new NotFoundException({ message: "expenses.supplier_not_found" });
    }
  }

  /** El almacén asignado del usuario (F3-HOME); sin él, el cliente manda `warehouseId`. */
  private async almacenAsignado(tx: Prisma.TransactionClient, user: AuthUser): Promise<string> {
    const fila = await tx.user.findFirst({
      where: { id: user.userId, tenantId: user.tenantId },
      select: { defaultWarehouseId: true },
    });
    if (fila?.defaultWarehouseId == null) {
      throw new UnprocessableEntityException({ message: "expenses.warehouse_required" });
    }
    return fila.defaultWarehouseId;
  }
}

function snapshotDeTasas(
  componentes: {
    code: string;
    name: string;
    rate: string;
    base: Prisma.Decimal;
    amount: Prisma.Decimal;
    sortOrder: number;
  }[],
): ExpenseTaxRate[] {
  return componentes.map((c) => ({
    code: c.code,
    name: c.name,
    rate: c.rate,
    base: c.base.toString(),
    amount: c.amount.toString(),
    sortOrder: c.sortOrder,
  }));
}

const fechaIso = (d: Date | null): string | null =>
  d === null ? null : d.toISOString().slice(0, 10);

export function toSummary(row: ExpenseRow): ExpenseSummary {
  return {
    id: row.id,
    folio: row.folio,
    warehouseId: row.warehouseId,
    warehouseName: row.warehouse.name,
    expenseDate: fechaIso(row.expenseDate) as string,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    supplierId: row.supplierId,
    supplierName: row.supplier?.name ?? null,
    beneficiary: row.beneficiary,
    description: row.description,
    reference: row.reference,
    amount: row.amount.toString(),
    discount: row.discount.toString(),
    taxGroupCode: row.taxGroupCode,
    taxRates: row.taxRates as unknown as ExpenseTaxRate[],
    taxAmount: row.taxAmount.toString(),
    total: row.total.toString(),
    taxMode: row.taxMode as TaxMode,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    paidAt: row.paidAt?.toISOString() ?? null,
    dueDate: fechaIso(row.dueDate),
    cashboxSessionId: row.cashboxSessionId,
    accountRef: row.accountRef,
    notes: row.notes,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    canceledAt: row.canceledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
  };
}
