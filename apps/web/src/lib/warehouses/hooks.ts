import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CreateWarehouseInput,
  createWarehouse,
  deleteWarehouse,
  listWarehouses,
  type UpdateWarehouseInput,
  updateWarehouse,
  type Warehouse,
} from "./api";

export const WAREHOUSES_QUERY_KEY = ["warehouses"] as const;

export function useWarehouses() {
  return useQuery<Warehouse[], ApiError>({
    queryKey: WAREHOUSES_QUERY_KEY,
    queryFn: () => listWarehouses(),
  });
}

/**
 * Los almacenes que el usuario puede operar: activos ∩ su alcance. Clave de
 * caché distinta porque devuelven cosas distintas — compartirla haría que la
 * pantalla de administración pisara la lista de los selectores.
 */
export function useScopedWarehouses() {
  return useQuery<Warehouse[], ApiError>({
    queryKey: [...WAREHOUSES_QUERY_KEY, "scoped"],
    queryFn: () => listWarehouses({ scoped: true }),
  });
}

export function useCreateWarehouse() {
  const queryClient = useQueryClient();
  return useMutation<Warehouse, ApiError, CreateWarehouseInput>({
    mutationFn: createWarehouse,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
    },
  });
}

export function useUpdateWarehouse() {
  const queryClient = useQueryClient();
  return useMutation<Warehouse, ApiError, { id: string; input: UpdateWarehouseInput }>({
    mutationFn: ({ id, input }) => updateWarehouse(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
    },
  });
}

export function useDeleteWarehouse() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: deleteWarehouse,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WAREHOUSES_QUERY_KEY });
    },
  });
}
