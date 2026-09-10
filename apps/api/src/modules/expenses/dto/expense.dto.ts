import {
  EXPENSE_PAYMENT_STATUSES,
  EXPENSE_STATUSES,
  hasValidMoneyScale,
  MONEY_MAX,
  PAYMENT_METHODS,
} from "@sellpoint/shared";
import { z } from "zod";

/**
 * F9-EXP-07 — los cuerpos de Gastos. Todos `.strict()`: un campo que el API
 * no conoce es un error del cliente, no un dato que se ignora en silencio.
 *
 * Un gasto es UNA línea: `amount` es lo capturado y `discount` un monto fijo
 * (nunca un porcentaje). Pagado ⇔ trae `paymentMethod`; la caja de origen
 * (`cashboxSessionId`) solo con efectivo. `supplierId` y `beneficiary` son
 * excluyentes: a quién se le pagó es UNA respuesta.
 */
const dinero = z.number().positive().max(MONEY_MAX).refine(hasValidMoneyScale, {
  message: "expenses.invalid_amount",
});
const descuento = z.number().min(0).max(MONEY_MAX).refine(hasValidMoneyScale, {
  message: "expenses.invalid_amount",
});
const texto = (max: number) => z.string().trim().min(1).max(max);
const fecha = z.iso.date();
const instante = z.iso.datetime();
const metodo = z.enum(PAYMENT_METHODS, { message: "expenses.invalid_payment_method" });

const pagoCoherente = <
  T extends { paymentMethod?: string | null; cashboxSessionId?: string | null },
>(
  value: T,
) => value.cashboxSessionId == null || value.paymentMethod === "cash";

export const createExpenseSchema = z
  .object({
    /** Sin él, el almacén asignado del usuario (F3-HOME). */
    warehouseId: z.uuid().optional(),
    expenseDate: fecha,
    categoryId: z.uuid(),
    supplierId: z.uuid().optional(),
    beneficiary: texto(120).optional(),
    description: texto(300),
    reference: texto(120).optional(),
    amount: dinero,
    discount: descuento.default(0),
    /** Ausente = el impuesto default del negocio; `null` = sin impuesto. */
    taxGroupId: z.uuid().nullable().optional(),
    /** Presente = nace PAGADO con ese método; ausente = pendiente. */
    paymentMethod: metodo.optional(),
    paidAt: instante.optional(),
    accountRef: texto(120).optional(),
    cashboxSessionId: z.uuid().optional(),
    dueDate: fecha.optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((v) => !(v.supplierId !== undefined && v.beneficiary !== undefined), {
    message: "expenses.payee_conflict",
    path: ["beneficiary"],
  })
  .refine(pagoCoherente, { message: "expenses.session_needs_cash", path: ["cashboxSessionId"] });

export const updateExpenseSchema = z
  .object({
    expenseDate: fecha.optional(),
    categoryId: z.uuid().optional(),
    supplierId: z.uuid().nullable().optional(),
    beneficiary: texto(120).nullable().optional(),
    description: texto(300).optional(),
    reference: texto(120).nullable().optional(),
    amount: dinero.optional(),
    discount: descuento.optional(),
    taxGroupId: z.uuid().nullable().optional(),
    accountRef: texto(120).nullable().optional(),
    dueDate: fecha.nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "expenses.empty_update" })
  .refine((v) => !(v.supplierId != null && v.beneficiary != null), {
    message: "expenses.payee_conflict",
    path: ["beneficiary"],
  });

export const payExpenseSchema = z
  .object({
    paymentMethod: metodo,
    paidAt: instante.optional(),
    accountRef: texto(120).optional(),
    cashboxSessionId: z.uuid().optional(),
  })
  .strict()
  .refine(pagoCoherente, { message: "expenses.session_needs_cash", path: ["cashboxSessionId"] });

export const cancelExpenseSchema = z
  .object({
    reason: z.string().trim().min(3, "expenses.cancel_reason_required").max(500),
  })
  .strict();

const rangoCoherente = (q: { from?: string; to?: string }) =>
  q.from === undefined || q.to === undefined || q.from <= q.to;

/** Los filtros que comparten el listado, el resumen y el export. */
const filtrosDeGastos = z.object({
  /** Folio, descripción, referencia, beneficiario o proveedor. */
  query: z.string().trim().min(1).max(120).optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  paymentStatus: z.enum(EXPENSE_PAYMENT_STATUSES).optional(),
  paymentMethod: metodo.optional(),
  categoryId: z.uuid().optional(),
  supplierId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
  /** Días del calendario del negocio sobre `expense_date` (DATE con DATE). */
  from: fecha.optional(),
  to: fecha.optional(),
});

export const listExpensesQuerySchema = filtrosDeGastos
  .extend({
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(20),
  })
  .strict()
  .refine(rangoCoherente, { message: "expenses.invalid_query", path: ["to"] });

export const exportExpensesQuerySchema = filtrosDeGastos
  .extend({ format: z.enum(["csv", "xlsx"]).default("xlsx") })
  .strict()
  .refine(rangoCoherente, { message: "expenses.invalid_query", path: ["to"] });

export type CreateExpenseDto = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseDto = z.infer<typeof updateExpenseSchema>;
export type PayExpenseDto = z.infer<typeof payExpenseSchema>;
export type CancelExpenseDto = z.infer<typeof cancelExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
export type ExportExpensesQuery = z.infer<typeof exportExpensesQuerySchema>;
