import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CreateExpenseCategoryInput,
  createExpenseCategory,
  type ExpenseCategoriesPage,
  type ExpenseCategory,
  type ListExpenseCategoriesParams,
  listExpenseCategories,
  removeExpenseCategory,
  type UpdateExpenseCategoryInput,
  updateExpenseCategory,
} from "./categories-api";

export const EXPENSE_CATEGORIES_QUERY_KEY = ["expenses", "categories"] as const;

/** F9-EXP-03 — las categorías de gasto. Toda mutación invalida el prefijo: pantalla y selector se refrescan. */
export function useExpenseCategories(
  params: ListExpenseCategoriesParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery<ExpenseCategoriesPage, ApiError>({
    queryKey: [...EXPENSE_CATEGORIES_QUERY_KEY, params],
    queryFn: () => listExpenseCategories(params),
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation<ExpenseCategory, ApiError, CreateExpenseCategoryInput>({
    mutationFn: (input) => createExpenseCategory(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_QUERY_KEY });
    },
  });
}

export function useUpdateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation<ExpenseCategory, ApiError, { id: string; input: UpdateExpenseCategoryInput }>({
    mutationFn: ({ id, input }) => updateExpenseCategory(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_QUERY_KEY });
    },
  });
}

export function useRemoveExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => removeExpenseCategory(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_QUERY_KEY });
    },
  });
}
