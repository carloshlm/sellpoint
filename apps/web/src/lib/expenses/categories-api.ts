import { api } from "@/lib/api";

/** Espejo del `ExpenseCategorySummary` del API (F9-EXP-03). */
export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseCategoriesPage {
  rows: ExpenseCategory[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateExpenseCategoryInput {
  name: string;
  code?: string;
}

export interface UpdateExpenseCategoryInput {
  name?: string;
  isActive?: boolean;
  sortOrder?: number;
}

export interface ListExpenseCategoriesParams {
  query?: string;
  isActive?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listExpenseCategories(
  params: ListExpenseCategoriesParams = {},
): Promise<ExpenseCategoriesPage> {
  const { data } = await api.get<ExpenseCategoriesPage>("/expenses/categories", {
    params: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.isActive !== undefined ? { isActive: String(params.isActive) } : {}),
      ...(params.page ? { page: params.page } : {}),
      ...(params.pageSize ? { pageSize: params.pageSize } : {}),
    },
  });
  return data;
}

export async function createExpenseCategory(
  input: CreateExpenseCategoryInput,
): Promise<ExpenseCategory> {
  const { data } = await api.post<ExpenseCategory>("/expenses/categories", input);
  return data;
}

export async function updateExpenseCategory(
  id: string,
  input: UpdateExpenseCategoryInput,
): Promise<ExpenseCategory> {
  const { data } = await api.patch<ExpenseCategory>(`/expenses/categories/${id}`, input);
  return data;
}

export async function removeExpenseCategory(id: string): Promise<void> {
  await api.delete(`/expenses/categories/${id}`);
}
