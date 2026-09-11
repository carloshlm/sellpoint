import type { PaymentMethod, TaxMode } from "@sellpoint/shared";
import { api } from "@/lib/api";
import { descargarBlob, nombreDeDescarga } from "@/lib/download";

/** El snapshot de un componente de impuesto (forma de `sale_taxes`). */
export interface ExpenseTaxRate {
  code: string;
  name: string;
  rate: string;
  base: string;
  amount: string;
  sortOrder: number;
}

export type ExpenseStatus = "active" | "canceled";
export type ExpensePaymentStatus = "pending" | "paid";

/** Espejo del `ExpenseSummary` del API (F9-EXP-05). El dinero viaja como texto decimal. */
export interface Expense {
  id: string;
  folio: string;
  warehouseId: string;
  warehouseName: string;
  /** `YYYY-MM-DD`, día del calendario del negocio. */
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
  status: ExpenseStatus;
  paymentStatus: ExpensePaymentStatus;
  paymentMethod: PaymentMethod | null;
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

export type ExpenseRow = Expense;

export interface ExpensesPage {
  rows: ExpenseRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExpenseSummary {
  count: number;
  amount: string;
  discount: string;
  tax: string;
  total: string;
  byCategory: { categoryId: string; categoryName: string; count: number; total: string }[];
  byPaymentStatus: { pending: string; paid: string };
}

export interface ListExpensesParams {
  query?: string;
  status?: ExpenseStatus;
  paymentStatus?: ExpensePaymentStatus;
  paymentMethod?: PaymentMethod;
  categoryId?: string;
  supplierId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateExpenseInput {
  warehouseId?: string;
  expenseDate: string;
  categoryId: string;
  supplierId?: string;
  beneficiary?: string;
  description: string;
  reference?: string;
  amount: number;
  discount?: number;
  /** Ausente = el impuesto default del negocio; `null` = sin impuesto. */
  taxGroupId?: string | null;
  /** Presente = nace pagado; ausente = pendiente. */
  paymentMethod?: PaymentMethod;
  accountRef?: string;
  cashboxSessionId?: string;
  dueDate?: string;
  notes?: string;
}

/** Presente = cambia; `null` = se limpia; ausente = no se toca. */
export interface UpdateExpenseInput {
  expenseDate?: string;
  categoryId?: string;
  supplierId?: string | null;
  beneficiary?: string | null;
  description?: string;
  reference?: string | null;
  amount?: number;
  discount?: number;
  taxGroupId?: string | null;
  accountRef?: string | null;
  dueDate?: string | null;
  notes?: string | null;
}

export interface PayExpenseInput {
  paymentMethod: PaymentMethod;
  accountRef?: string;
  cashboxSessionId?: string;
}

/** Solo viajan los filtros con valor: un `from: ""` haría que el API rechace la consulta. */
function limpiar<T extends object>(params: T): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== null),
  ) as Record<string, string | number>;
}

export async function listExpenses(params: ListExpensesParams = {}): Promise<ExpensesPage> {
  const { data } = await api.get<ExpensesPage>("/expenses", { params: limpiar(params) });
  return data;
}

export async function getExpense(id: string): Promise<Expense> {
  const { data } = await api.get<Expense>(`/expenses/${id}`);
  return data;
}

export async function createExpense(input: CreateExpenseInput): Promise<Expense> {
  const { data } = await api.post<Expense>("/expenses", input);
  return data;
}

export async function updateExpense(id: string, input: UpdateExpenseInput): Promise<Expense> {
  const { data } = await api.patch<Expense>(`/expenses/${id}`, input);
  return data;
}

export async function payExpense(id: string, input: PayExpenseInput): Promise<Expense> {
  const { data } = await api.post<Expense>(`/expenses/${id}/pay`, input);
  return data;
}

export async function cancelExpense(id: string, reason: string): Promise<Expense> {
  const { data } = await api.post<Expense>(`/expenses/${id}/cancel`, { reason });
  return data;
}

export async function getExpenseSummary(
  params: Omit<ListExpensesParams, "page" | "pageSize"> = {},
): Promise<ExpenseSummary> {
  const { data } = await api.get<ExpenseSummary>("/expenses/summary", { params: limpiar(params) });
  return data;
}

export async function listExpenseAccounts(): Promise<string[]> {
  const { data } = await api.get<string[]>("/expenses/accounts");
  return data;
}

/** El export con los filtros vigentes, SIN paginación: baja el archivo entero. */
export async function downloadExpenses(
  params: Omit<ListExpensesParams, "page" | "pageSize"> & { format: "csv" | "xlsx" },
): Promise<void> {
  const { data, headers } = await api.get<Blob>("/expenses/export", {
    params: limpiar(params),
    responseType: "blob",
  });
  await descargarBlob(data, nombreDeDescarga(headers, `gastos.${params.format}`));
}
