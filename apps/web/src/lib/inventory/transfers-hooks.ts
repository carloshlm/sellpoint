import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  cancelTransfer,
  createReceiptDraft,
  getTransfer,
  type ListTransfersParams,
  listTransfers,
  type TransferDetail,
  type TransferPage,
} from "./transfers-api";

export const TRANSFERS_QUERY_KEY = ["transfers"] as const;

export function useTransfers(params: ListTransfersParams) {
  return useQuery<TransferPage, ApiError>({
    queryKey: [...TRANSFERS_QUERY_KEY, params],
    queryFn: () => listTransfers(params),
    // El server pagina: sin esto la tabla parpadearía al cambiar de tab.
    placeholderData: (previous) => previous,
  });
}

export function useTransfer(id: string | null) {
  return useQuery<TransferDetail, ApiError>({
    queryKey: [...TRANSFERS_QUERY_KEY, id],
    queryFn: () => getTransfer(id as string),
    enabled: id !== null,
  });
}

export function useCreateReceiptDraft() {
  return useMutation<{ id: string; folio: string }, ApiError, string>({
    // Envuelto y no pasado directo: react-query v5 le mete su contexto como
    // SEGUNDO argumento al `mutationFn`, y eso se filtraría hasta la capa de
    // API. Acá se corta.
    mutationFn: (id) => createReceiptDraft(id),
  });
}

/**
 * Cancelar cambia los contadores de los dos tabs, así que invalida el listado
 * entero y no solo la fila.
 */
export function useCancelTransfer() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) => cancelTransfer(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRANSFERS_QUERY_KEY });
    },
  });
}
