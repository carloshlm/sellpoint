import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CreateServiceInput,
  createService,
  listServices,
  removeService,
  type Service,
  type UpdateServiceInput,
  updateService,
} from "./api";

export const SERVICES_QUERY_KEY = ["services"] as const;

/** La búsqueda entra en la CLAVE: dos filtros distintos son dos cachés. */
export function useServices(params: { query?: string } = {}) {
  return useQuery<Service[], ApiError>({
    queryKey: [...SERVICES_QUERY_KEY, params.query ?? ""],
    queryFn: () => listServices(params),
  });
}

export function useCreateService() {
  const queryClient = useQueryClient();
  return useMutation<Service, ApiError, CreateServiceInput>({
    mutationFn: createService,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
  });
}

export function useUpdateService() {
  const queryClient = useQueryClient();
  return useMutation<Service, ApiError, { id: string; input: UpdateServiceInput }>({
    mutationFn: ({ id, input }) => updateService(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
  });
}

export function useRemoveService() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: removeService,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SERVICES_QUERY_KEY });
    },
  });
}
