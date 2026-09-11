import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { DOCUMENTS_QUERY_KEY } from "@/lib/inventory/hooks";
import {
  cancelPurchase,
  confirmPurchase,
  createEntryDraft,
  createPurchase,
  getPurchase,
  type ListPurchasesParams,
  listPurchases,
  type Purchase,
  type PurchaseChargeInput,
  type PurchaseLineInput,
  type PurchasesPage,
  replacePurchaseCharges,
  replacePurchaseLines,
  type UpdatePurchaseInput,
  updatePurchase,
  updateReception,
} from "./api";

export const PURCHASES_QUERY_KEY = ["purchases"] as const;

/**
 * F9-PURCH-10 — los hooks de Compras. Cada mutación devuelve la compra
 * ENTERA (el API recalcula totales e impuestos en cada guardado), así que se
 * escribe directo en la caché del detalle: la pantalla repinta los totales
 * sin un refetch de ida y vuelta.
 */
function claveDetalle(id: string) {
  return [...PURCHASES_QUERY_KEY, "one", id];
}

export function usePurchases(params: ListPurchasesParams = {}) {
  return useQuery<PurchasesPage, ApiError>({
    queryKey: [...PURCHASES_QUERY_KEY, params],
    queryFn: () => listPurchases(params),
    placeholderData: (previous) => previous,
  });
}

export function usePurchase(id: string | null) {
  return useQuery<Purchase, ApiError>({
    queryKey: claveDetalle(id ?? ""),
    queryFn: () => getPurchase(id as string),
    enabled: id !== null,
  });
}

export function useCreatePurchase() {
  const queryClient = useQueryClient();
  return useMutation<Purchase, ApiError, { supplierId: string; purchaseDate: string }>({
    mutationFn: (input) => createPurchase(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PURCHASES_QUERY_KEY });
    },
  });
}

/** Guarda la compra devuelta y refresca el listado: los totales ya vienen hechos. */
function useMutacionDeCompra<TInput>(
  mutationFn: (input: TInput & { id: string }) => Promise<Purchase>,
) {
  const queryClient = useQueryClient();
  return useMutation<Purchase, ApiError, TInput & { id: string }>({
    mutationFn,
    onSuccess: (compra) => {
      queryClient.setQueryData(claveDetalle(compra.id), compra);
      void queryClient.invalidateQueries({ queryKey: PURCHASES_QUERY_KEY });
    },
  });
}

export function useUpdatePurchase() {
  return useMutacionDeCompra<{ input: UpdatePurchaseInput }>(({ id, input }) =>
    updatePurchase(id, input),
  );
}

export function useUpdateReception() {
  return useMutacionDeCompra<{
    input: { receivedDate?: string | null; supplierInvoice?: string | null; notes?: string | null };
  }>(({ id, input }) => updateReception(id, input));
}

export function useReplacePurchaseLines() {
  return useMutacionDeCompra<{ lines: PurchaseLineInput[] }>(({ id, lines }) =>
    replacePurchaseLines(id, lines),
  );
}

export function useReplacePurchaseCharges() {
  return useMutacionDeCompra<{ charges: PurchaseChargeInput[] }>(({ id, charges }) =>
    replacePurchaseCharges(id, charges),
  );
}

export function useConfirmPurchase() {
  return useMutacionDeCompra<Record<never, never>>(({ id }) => confirmPurchase(id));
}

export function useCancelPurchase() {
  return useMutacionDeCompra<{ reason: string }>(({ id, reason }) => cancelPurchase(id, reason));
}

/**
 * El puente. Invalida también los DOCUMENTOS de inventario: la entrada nueva
 * tiene que aparecer en su listado sin recargar.
 */
export function useCreateEntryDraft() {
  const queryClient = useQueryClient();
  return useMutation<{ id: string; folio: string; status: string }, ApiError, string>({
    mutationFn: (id) => createEntryDraft(id),
    onSuccess: (_entrada, id) => {
      void queryClient.invalidateQueries({ queryKey: claveDetalle(id) });
      void queryClient.invalidateQueries({ queryKey: DOCUMENTS_QUERY_KEY });
    },
  });
}
