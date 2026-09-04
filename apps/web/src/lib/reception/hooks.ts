import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  attendTurn,
  type CreateCustomerInput,
  type Customer,
  type CustomersPage,
  createCustomer,
  createTurn,
  getCustomer,
  type ListCustomersParams,
  listCustomers,
  listTurns,
  removeCustomer,
  type Turn,
  type UpdateCustomerInput,
  updateCustomer,
  waitTurn,
} from "./api";

export const CUSTOMERS_QUERY_KEY = ["reception", "customers"] as const;
export const TURNS_QUERY_KEY = ["reception", "turns"] as const;

/**
 * F9-RECEP-09 — los hooks de Recepción. La lista de turnos se refresca sola
 * cada 15 s: es una pantalla de pared con dos personas mirándola, y sin
 * refresco la recepcionista llama a un turno que su compañera ya atendió.
 * En una pestaña oculta no refresca (default de react-query).
 */
export const TURNS_REFETCH_MS = 15_000;

export function useCustomers(params: ListCustomersParams = {}) {
  return useQuery<CustomersPage, ApiError>({
    queryKey: [...CUSTOMERS_QUERY_KEY, params],
    queryFn: () => listCustomers(params),
    placeholderData: (previous) => previous,
  });
}

export function useCustomer(id: string | null) {
  return useQuery<Customer, ApiError>({
    queryKey: [...CUSTOMERS_QUERY_KEY, "one", id],
    queryFn: () => getCustomer(id as string),
    enabled: id !== null,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation<Customer, ApiError, CreateCustomerInput>({
    // Envuelta: react-query pasa un segundo argumento (el contexto de la
    // mutación) y el cliente HTTP no debe verlo.
    mutationFn: (input) => createCustomer(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
    },
  });
}

export function useUpdateCustomer() {
  const queryClient = useQueryClient();
  return useMutation<Customer, ApiError, { id: string; input: UpdateCustomerInput }>({
    mutationFn: ({ id, input }) => updateCustomer(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
    },
  });
}

export function useRemoveCustomer() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => removeCustomer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
    },
  });
}

export function useTurns(params: { date?: string } = {}) {
  return useQuery<Turn[], ApiError>({
    queryKey: [...TURNS_QUERY_KEY, params],
    queryFn: () => listTurns(params),
    placeholderData: (previous) => previous,
    refetchInterval: TURNS_REFETCH_MS,
  });
}

export function useCreateTurn() {
  const queryClient = useQueryClient();
  return useMutation<Turn, ApiError, { customerId?: string }>({
    mutationFn: (input) => createTurn(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TURNS_QUERY_KEY });
    },
  });
}

export function useAttendTurn() {
  const queryClient = useQueryClient();
  return useMutation<Turn, ApiError, string>({
    mutationFn: (id) => attendTurn(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TURNS_QUERY_KEY });
    },
  });
}

export function useWaitTurn() {
  const queryClient = useQueryClient();
  return useMutation<Turn, ApiError, string>({
    mutationFn: (id) => waitTurn(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TURNS_QUERY_KEY });
    },
  });
}
