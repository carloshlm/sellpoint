import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import type { Purchase } from "@/lib/purchases/api";
import { PURCHASES_QUERY_KEY } from "@/lib/purchases/hooks";
import {
  cancelPurchaseOrder,
  cancelPurchaseReceipt,
  closePurchaseOrder,
  closePurchaseOrderLineShort,
  confirmPurchaseReceipt,
  createPurchaseFromReceipts,
  createPurchaseOrder,
  createPurchaseReceipt,
  getPurchaseOrder,
  getPurchaseReceipt,
  issuePurchaseOrder,
  type ListPurchaseOrdersParams,
  listPurchaseOrders,
  type PurchaseOrder,
  type PurchaseOrderLineInput,
  type PurchaseOrdersPage,
  type PurchaseReceipt,
  type PurchaseReceiptLineInput,
  replacePurchaseOrderLines,
  replacePurchaseReceiptLines,
  type UpdatePurchaseOrderInput,
  updatePurchaseOrder,
  updatePurchaseReceipt,
} from "./api";

export const PURCHASE_ORDERS_QUERY_KEY = ["purchase-orders"] as const;

/**
 * F9-PO-11 — los hooks de Órdenes de compra. Cada mutación de la orden
 * devuelve la orden ENTERA y se escribe en la caché del detalle; las de la
 * recepción invalidan la orden (su estado y sus pendientes cambian con ella).
 */
const claveOrden = (id: string) => [...PURCHASE_ORDERS_QUERY_KEY, "one", id];
const claveRecepcion = (orderId: string, receiptId: string) => [
  ...PURCHASE_ORDERS_QUERY_KEY,
  "one",
  orderId,
  "receipts",
  receiptId,
];

export function usePurchaseOrders(params: ListPurchaseOrdersParams = {}) {
  return useQuery<PurchaseOrdersPage, ApiError>({
    queryKey: [...PURCHASE_ORDERS_QUERY_KEY, params],
    queryFn: () => listPurchaseOrders(params),
    placeholderData: (previous) => previous,
  });
}

export function usePurchaseOrder(id: string | null) {
  return useQuery<PurchaseOrder, ApiError>({
    queryKey: claveOrden(id ?? ""),
    queryFn: () => getPurchaseOrder(id as string),
    enabled: id !== null,
  });
}

export function useCreatePurchaseOrder() {
  const queryClient = useQueryClient();
  return useMutation<
    PurchaseOrder,
    ApiError,
    { supplierId: string; orderDate: string; expectedDate?: string | null }
  >({
    mutationFn: (input) => createPurchaseOrder(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY });
    },
  });
}

function useMutacionDeOrden<TInput>(
  mutationFn: (input: TInput & { id: string }) => Promise<PurchaseOrder>,
) {
  const queryClient = useQueryClient();
  return useMutation<PurchaseOrder, ApiError, TInput & { id: string }>({
    mutationFn,
    onSuccess: (orden) => {
      queryClient.setQueryData(claveOrden(orden.id), orden);
      void queryClient.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY, exact: false });
    },
  });
}

export function useUpdatePurchaseOrder() {
  return useMutacionDeOrden<{ input: UpdatePurchaseOrderInput }>(({ id, input }) =>
    updatePurchaseOrder(id, input),
  );
}

export function useReplacePurchaseOrderLines() {
  return useMutacionDeOrden<{ lines: PurchaseOrderLineInput[] }>(({ id, lines }) =>
    replacePurchaseOrderLines(id, lines),
  );
}

export function useIssuePurchaseOrder() {
  return useMutacionDeOrden<Record<never, never>>(({ id }) => issuePurchaseOrder(id));
}

export function useClosePurchaseOrder() {
  return useMutacionDeOrden<Record<never, never>>(({ id }) => closePurchaseOrder(id));
}

export function useClosePurchaseOrderLineShort() {
  return useMutacionDeOrden<{ lineNo: number }>(({ id, lineNo }) =>
    closePurchaseOrderLineShort(id, lineNo),
  );
}

export function useCancelPurchaseOrder() {
  return useMutacionDeOrden<{ reason: string }>(({ id, reason }) =>
    cancelPurchaseOrder(id, reason),
  );
}

// ── Recepciones ───────────────────────────────────────────────────────────

export function usePurchaseReceipt(orderId: string | null, receiptId: string | null) {
  return useQuery<PurchaseReceipt, ApiError>({
    queryKey: claveRecepcion(orderId ?? "", receiptId ?? ""),
    queryFn: () => getPurchaseReceipt(orderId as string, receiptId as string),
    enabled: orderId !== null && receiptId !== null,
  });
}

/** Una mutación de recepción guarda la recepción y refresca su orden (estado y pendientes). */
function useMutacionDeRecepcion<TInput>(
  mutationFn: (input: TInput & { orderId: string; receiptId: string }) => Promise<PurchaseReceipt>,
) {
  const queryClient = useQueryClient();
  return useMutation<PurchaseReceipt, ApiError, TInput & { orderId: string; receiptId: string }>({
    mutationFn,
    onSuccess: (recepcion, variables) => {
      queryClient.setQueryData(claveRecepcion(variables.orderId, recepcion.id), recepcion);
      void queryClient.invalidateQueries({ queryKey: claveOrden(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: PURCHASE_ORDERS_QUERY_KEY, exact: false });
    },
  });
}

export function useCreatePurchaseReceipt() {
  const queryClient = useQueryClient();
  return useMutation<PurchaseReceipt, ApiError, string>({
    mutationFn: (orderId) => createPurchaseReceipt(orderId),
    onSuccess: (recepcion, orderId) => {
      queryClient.setQueryData(claveRecepcion(orderId, recepcion.id), recepcion);
      void queryClient.invalidateQueries({ queryKey: claveOrden(orderId) });
    },
  });
}

export function useUpdatePurchaseReceipt() {
  return useMutacionDeRecepcion<{
    input: { receivedDate?: string; packingSlip?: string | null; notes?: string | null };
  }>(({ orderId, receiptId, input }) => updatePurchaseReceipt(orderId, receiptId, input));
}

export function useReplacePurchaseReceiptLines() {
  return useMutacionDeRecepcion<{ lines: PurchaseReceiptLineInput[] }>(
    ({ orderId, receiptId, lines }) => replacePurchaseReceiptLines(orderId, receiptId, lines),
  );
}

export function useConfirmPurchaseReceipt() {
  return useMutacionDeRecepcion<Record<never, never>>(({ orderId, receiptId }) =>
    confirmPurchaseReceipt(orderId, receiptId),
  );
}

export function useCancelPurchaseReceipt() {
  return useMutacionDeRecepcion<{ reason: string }>(({ orderId, receiptId, reason }) =>
    cancelPurchaseReceipt(orderId, receiptId, reason),
  );
}

/** F9-PO-13: la compra nace de lo recibido; refresca la orden y el listado de compras. */
export function useCreatePurchaseFromReceipts() {
  const queryClient = useQueryClient();
  return useMutation<Purchase, ApiError, { orderId: string; receiptIds: string[] }>({
    mutationFn: ({ orderId, receiptIds }) => createPurchaseFromReceipts(orderId, receiptIds),
    onSuccess: (_compra, variables) => {
      void queryClient.invalidateQueries({ queryKey: claveOrden(variables.orderId) });
      void queryClient.invalidateQueries({ queryKey: PURCHASES_QUERY_KEY });
    },
  });
}
