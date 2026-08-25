import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CreateServiceInput,
  createService,
  listServices,
  removeService,
  type Service,
  type ServicesPage,
  type UpdateServiceInput,
  updateService,
} from "./api";

export const SERVICES_QUERY_KEY = ["services"] as const;

/** La búsqueda entra en la CLAVE: dos filtros distintos son dos cachés. */
export function useServices(params: { query?: string; page?: number } = {}) {
  return useQuery<ServicesPage, ApiError>({
    queryKey: [...SERVICES_QUERY_KEY, params],
    queryFn: () => listServices(params),
    // Conserva la página anterior mientras llega la nueva: sin esto, cada
    // cambio de página vacía la tabla y la pantalla parpadea.
    placeholderData: (previous) => previous,
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
