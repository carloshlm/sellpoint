import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  cancelDocument,
  confirmDocument,
  createDocument,
  getDocument,
  listDocuments,
  listExpiring,
  updateDocumentHeader,
} from "./api";
import type {
  DocumentDetail,
  DocumentPage,
  DocumentSummary,
  ExpiringRow,
  ListDocumentsParams,
} from "./types";

export const DOCUMENTS_QUERY_KEY = ["inventory", "documents"] as const;
export const EXPIRING_QUERY_KEY = ["inventory", "expiring"] as const;

/** Lo que está por vencerse. Sin cron: se consulta al abrir la pantalla. */
export function useExpiring(
  params: { days: number; warehouseId?: string },
  options?: { enabled?: boolean },
) {
  return useQuery<ExpiringRow[], ApiError>({
    queryKey: [...EXPIRING_QUERY_KEY, params],
    queryFn: () => listExpiring(params),
    enabled: options?.enabled ?? true,
  });
}

export function useDocuments(params: ListDocumentsParams) {
  return useQuery<DocumentPage, ApiError>({
    queryKey: [...DOCUMENTS_QUERY_KEY, params],
    queryFn: () => listDocuments(params),
  });
}

/**
 * El detalle ES la vista previa, así que se recarga cada vez que cambian las
 * líneas: mostrar un stock resultante viejo sería peor que no mostrarlo.
 */
export function useDocument(id: string | null) {
  return useQuery<DocumentDetail, ApiError>({
    queryKey: [...DOCUMENTS_QUERY_KEY, id],
    queryFn: () => getDocument(id as string),
    enabled: id !== null,
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation<DocumentSummary, ApiError, Parameters<typeof createDocument>[0]>({
    mutationFn: createDocument,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },
  });
}

export function useUpdateDocumentHeader(id: string) {
  const queryClient = useQueryClient();
  return useMutation<DocumentSummary, ApiError, Parameters<typeof updateDocumentHeader>[1]>({
    mutationFn: (input) => updateDocumentHeader(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...DOCUMENTS_QUERY_KEY, id] });
    },
  });
}

/**
 * Confirmar mueve stock, así que invalida TODO lo que depende de él: el
 * documento, los listados, y los productos y traspasos que muestran saldos.
 * Olvidar una de esas claves deja la pantalla mintiendo hasta el próximo
 * refresco.
 */
export function useConfirmDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation<{ document: DocumentSummary }, ApiError, void>({
    mutationFn: () => confirmDocument(id),
    onSuccess: () => {
      for (const key of [DOCUMENTS_QUERY_KEY, ["products"], ["stock"], ["transfers"]]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useCancelDocument(id: string) {
  const queryClient = useQueryClient();
  return useMutation<DocumentSummary, ApiError, string | undefined>({
    mutationFn: (reason) => cancelDocument(id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },
  });
}
