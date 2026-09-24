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

/**
 * `enabled` para quien trae la lista de otro lado (F10-MANFIX-08): un hook no
 * puede vivir detrás de un `if`, y `WarehouseSelect` con `source` no debe
 * pedir `/warehouses` — a quien no tiene `warehouses:read` le responde 403.
 */
export function useWarehouses(enabled = true) {
  return useQuery<Warehouse[], ApiError>({
    queryKey: WAREHOUSES_QUERY_KEY,
    queryFn: () => listWarehouses(),
    enabled,
  });
}

/**
 * Los almacenes que el usuario puede operar: activos ∩ su alcance. Clave de
 * caché distinta porque devuelven cosas distintas — compartirla haría que la
 * pantalla de administración pisara la lista de los selectores.
 */
export function useScopedWarehouses(enabled = true) {
  return useQuery<Warehouse[], ApiError>({
    queryKey: [...WAREHOUSES_QUERY_KEY, "scoped"],
    queryFn: () => listWarehouses({ scoped: true }),
    enabled,
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
