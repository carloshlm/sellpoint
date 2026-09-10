import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CreateSupplierInput,
  createSupplier,
  getSupplier,
  type ListSuppliersParams,
  listSuppliers,
  removeSupplier,
  type Supplier,
  type SuppliersPage,
  type UpdateSupplierInput,
  updateSupplier,
} from "./api";

export const SUPPLIERS_QUERY_KEY = ["suppliers"] as const;

/**
 * F9-SUPPL-06 — los hooks del catálogo de proveedores (molde: Recepción).
 * Toda mutación invalida la raíz `["suppliers"]`: el listado, el picker y la
 * ficha comparten prefijo, así que un alta se ve en los tres.
 */
export function useSuppliers(
  params: ListSuppliersParams = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery<SuppliersPage, ApiError>({
    queryKey: [...SUPPLIERS_QUERY_KEY, params],
    queryFn: () => listSuppliers(params),
    placeholderData: (previous) => previous,
    enabled: options.enabled ?? true,
  });
}

export function useSupplier(id: string | null) {
  return useQuery<Supplier, ApiError>({
    queryKey: [...SUPPLIERS_QUERY_KEY, "one", id],
    queryFn: () => getSupplier(id as string),
    enabled: id !== null,
  });
}

export function useCreateSupplier() {
  const queryClient = useQueryClient();
  return useMutation<Supplier, ApiError, CreateSupplierInput>({
    // Envuelta: react-query pasa un segundo argumento (su contexto) que el
    // cliente HTTP no tiene por qué ver.
    mutationFn: (input) => createSupplier(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}

export function useUpdateSupplier() {
  const queryClient = useQueryClient();
  return useMutation<Supplier, ApiError, { id: string; input: UpdateSupplierInput }>({
    mutationFn: ({ id, input }) => updateSupplier(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}

export function useRemoveSupplier() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: (id) => removeSupplier(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUPPLIERS_QUERY_KEY });
    },
  });
}
