import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { POS_SESSION_KEY } from "@/lib/pos/hooks";
import {
  type CreateExpenseInput,
  cancelExpense,
  createExpense,
  type Expense,
  type ExpenseSummary,
  type ExpensesPage,
  getExpense,
  getExpenseSummary,
  type ListExpensesParams,
  listExpenseAccounts,
  listExpenses,
  type PayExpenseInput,
  payExpense,
  type UpdateExpenseInput,
  updateExpense,
} from "./api";

export const EXPENSES_QUERY_KEY = ["expenses", "list"] as const;
export const EXPENSES_SUMMARY_KEY = ["expenses", "summary"] as const;
export const EXPENSES_ACCOUNTS_KEY = ["expenses", "accounts"] as const;
/** El reporte de cierres lee los gastos del cajón: un gasto en efectivo lo toca. */
const SHIFTS_REPORT_KEY = ["reports", "shifts"] as const;

/**
 * F9-EXP-12 — los hooks de Gastos. Toda mutación invalida listado, resumen y
 * cuentas; pagar o anular invalidan además el arqueo del turno
 * (`POS_SESSION_KEY`) y el reporte de cierres: un gasto en efectivo mueve el
 * efectivo esperado, y la pantalla de cierre no puede quedarse con el viejo.
 */
function invalidarTodo(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
  void queryClient.invalidateQueries({ queryKey: EXPENSES_SUMMARY_KEY });
  void queryClient.invalidateQueries({ queryKey: EXPENSES_ACCOUNTS_KEY });
  void queryClient.invalidateQueries({ queryKey: POS_SESSION_KEY });
  void queryClient.invalidateQueries({ queryKey: SHIFTS_REPORT_KEY });
}

export function useExpenses(params: ListExpensesParams = {}) {
  return useQuery<ExpensesPage, ApiError>({
    queryKey: [...EXPENSES_QUERY_KEY, params],
    queryFn: () => listExpenses(params),
    placeholderData: (previous) => previous,
  });
}

export function useExpense(id: string | null) {
  return useQuery<Expense, ApiError>({
    queryKey: [...EXPENSES_QUERY_KEY, "one", id],
    queryFn: () => getExpense(id as string),
    enabled: id !== null,
  });
}

/** El resumen va en su propia consulta: no cambia al cambiar de página. */
export function useExpenseSummary(params: Omit<ListExpensesParams, "page" | "pageSize"> = {}) {
  return useQuery<ExpenseSummary, ApiError>({
    queryKey: [...EXPENSES_SUMMARY_KEY, params],
    queryFn: () => getExpenseSummary(params),
    placeholderData: (previous) => previous,
  });
}

export function useExpenseAccounts(enabled = true) {
  return useQuery<string[], ApiError>({
    queryKey: EXPENSES_ACCOUNTS_KEY,
    queryFn: listExpenseAccounts,
    enabled,
    staleTime: 60_000,
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation<Expense, ApiError, CreateExpenseInput>({
    // Envuelta: react-query pasa un segundo argumento (su contexto) que el
    // cliente HTTP no tiene por qué ver.
    mutationFn: (input) => createExpense(input),
    onSuccess: () => invalidarTodo(queryClient),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation<Expense, ApiError, { id: string; input: UpdateExpenseInput }>({
    mutationFn: ({ id, input }) => updateExpense(id, input),
    onSuccess: () => invalidarTodo(queryClient),
  });
}

export function usePayExpense() {
  const queryClient = useQueryClient();
  return useMutation<Expense, ApiError, { id: string; input: PayExpenseInput }>({
    mutationFn: ({ id, input }) => payExpense(id, input),
    onSuccess: () => invalidarTodo(queryClient),
  });
}

export function useCancelExpense() {
  const queryClient = useQueryClient();
  return useMutation<Expense, ApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => cancelExpense(id, reason),
    onSuccess: () => invalidarTodo(queryClient),
  });
}
