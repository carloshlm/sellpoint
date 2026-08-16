import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CreateWarehouseInput,
  createWarehouse,
  listWarehouses,
  type UpdateWarehouseInput,
  updateWarehouse,
  type Warehouse,
} from "./api";

export const WAREHOUSES_QUERY_KEY = ["warehouses"] as const;

export function useWarehouses() {
  return useQuery<Warehouse[], ApiError>({
    queryKey: WAREHOUSES_QUERY_KEY,
    queryFn: listWarehouses,
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
