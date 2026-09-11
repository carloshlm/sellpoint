import type {
  PurchaseOrderStatus,
  PurchaseReceiptStatus,
  PurchaseTaxMode,
} from "@sellpoint/shared";
import { api } from "@/lib/api";
import { imprimirPdf } from "@/lib/download";
import type { Purchase } from "@/lib/purchases/api";

/** Espejo de `PurchaseOrderLineView` del API (F9-PO-04). */
export interface PurchaseOrderLine {
  id: string;
  lineNo: number;
  productId: string;
  productSku: string;
  presentationId: string | null;
  presentationName: string | null;
  quantityOrdered: string;
  quantityReceived: string;
  /** DERIVADO: `pedido − recibido`, nunca negativo. */
  pending: string;
  closedShort: boolean;
  unitCost: string | null;
  discount: string;
  taxGroupCode: string | null;
  taxAmount: string;
  lineTotal: string;
  description: string;
}

export interface PurchaseOrderRow {
  id: string;
  folio: string;
  status: PurchaseOrderStatus;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  orderDate: string;
  expectedDate: string | null;
  supplierReference: string | null;
  paymentTerms: string | null;
  taxMode: PurchaseTaxMode;
  subtotal: string;
  discount: string;
  taxTotal: string;
  total: string;
  notes: string | null;
  lineCount: number;
  createdAt: string;
  issuedAt: string | null;
  closedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface PurchaseOrderProduct {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  presentations: { id: string; name: string; factor: string; isPurchasable: boolean }[];
}

export interface PurchaseOrderReceiptSummary {
  id: string;
  folio: string;
  status: PurchaseReceiptStatus;
  receivedDate: string;
  packingSlip: string | null;
  purchase: { id: string; folio: string; status: string } | null;
}

export interface PurchaseOrder extends PurchaseOrderRow {
  lines: PurchaseOrderLine[];
  products: PurchaseOrderProduct[];
  taxes: { code: string; name: string; rate: string; base: string; amount: string }[];
  receipts: PurchaseOrderReceiptSummary[];
  purchases: { id: string; folio: string; status: string; total: string }[];
}

export interface PurchaseOrdersPage {
  rows: PurchaseOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Del FILTRO completo, sin anuladas: cuántas, cuánto esperan y cuántas siguen abiertas. */
  summary: { count: number; total: string; pendingCount: number };
}

export interface ListPurchaseOrdersParams {
  query?: string;
  folio?: string;
  status?: PurchaseOrderStatus;
  supplierId?: string;
  warehouseId?: string;
  from?: string;
  to?: string;
  expectedFrom?: string;
  expectedTo?: string;
  pendingOnly?: boolean;
  pendingInvoice?: boolean;
  page?: number;
  pageSize?: number;
}

export interface UpdatePurchaseOrderInput {
  supplierId?: string;
  warehouseId?: string;
  orderDate?: string;
  expectedDate?: string | null;
  supplierReference?: string | null;
  paymentTerms?: string | null;
  taxMode?: PurchaseTaxMode;
  notes?: string | null;
}

export interface PurchaseOrderLineInput {
  productId: string;
  presentationId?: string | null;
  quantity: number;
  unitCost?: number | null;
  discount?: number;
  taxGroupId?: string | null;
}

/** Espejo de `PurchaseReceiptDetail` del API (F9-PO-07). */
export interface PurchaseReceiptLine {
  id: string;
  lineNo: number;
  purchaseOrderLineId: string;
  orderLineNo: number;
  productId: string;
  productSku: string;
  description: string;
  presentationName: string | null;
  tracksLots: boolean;
  quantityOrdered: string;
  quantityReceived: string;
  pending: string;
  quantity: string;
  lotCode: string | null;
  expiresAt: string | null;
  notes: string | null;
}

export interface PurchaseReceipt {
  id: string;
  folio: string;
  status: PurchaseReceiptStatus;
  purchaseOrderId: string;
  orderFolio: string;
  orderStatus: PurchaseOrderStatus;
  receivedDate: string;
  packingSlip: string | null;
  notes: string | null;
  purchase: { id: string; folio: string; status: string } | null;
  lines: PurchaseReceiptLine[];
  createdAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

export interface PurchaseReceiptLineInput {
  purchaseOrderLineId: string;
  quantity: number;
  lotCode?: string | null;
  expiresAt?: string | null;
  notes?: string | null;
}

/** Solo viajan los filtros con valor: un `from: ""` haría que el API rechace la consulta. */
function limpiar<T extends object>(params: T): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "" && v !== null && v !== false)
      .map(([k, v]) => [k, typeof v === "boolean" ? String(v) : (v as string | number)]),
  );
}

export async function listPurchaseOrders(
  params: ListPurchaseOrdersParams = {},
): Promise<PurchaseOrdersPage> {
  const { data } = await api.get<PurchaseOrdersPage>("/purchase-orders", {
    params: limpiar(params),
  });
  return data;
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  const { data } = await api.get<PurchaseOrder>(`/purchase-orders/${id}`);
  return data;
}

export async function createPurchaseOrder(input: {
  supplierId: string;
  warehouseId?: string;
  orderDate: string;
  expectedDate?: string | null;
}): Promise<PurchaseOrder> {
  const { data } = await api.post<PurchaseOrder>("/purchase-orders", input);
  return data;
}

export async function updatePurchaseOrder(
  id: string,
  input: UpdatePurchaseOrderInput,
): Promise<PurchaseOrder> {
  const { data } = await api.patch<PurchaseOrder>(`/purchase-orders/${id}`, input);
  return data;
}

export async function replacePurchaseOrderLines(
  id: string,
  lines: PurchaseOrderLineInput[],
): Promise<PurchaseOrder> {
  const { data } = await api.put<PurchaseOrder>(`/purchase-orders/${id}/lines`, { lines });
  return data;
}

export async function issuePurchaseOrder(id: string): Promise<PurchaseOrder> {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/issue`, {});
  return data;
}

export async function closePurchaseOrder(id: string): Promise<PurchaseOrder> {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/close`, {});
  return data;
}

export async function closePurchaseOrderLineShort(
  id: string,
  lineNo: number,
): Promise<PurchaseOrder> {
  const { data } = await api.post<PurchaseOrder>(
    `/purchase-orders/${id}/lines/${lineNo}/close-short`,
    {},
  );
  return data;
}

export async function cancelPurchaseOrder(id: string, reason: string): Promise<PurchaseOrder> {
  const { data } = await api.post<PurchaseOrder>(`/purchase-orders/${id}/cancel`, { reason });
  return data;
}

/** El papel que se manda al proveedor, directo al cuadro de impresión. */
export async function printPurchaseOrder(id: string, folio: string): Promise<void> {
  const { data } = await api.get<Blob>(`/purchase-orders/${id}/document`, {
    responseType: "blob",
  });
  imprimirPdf(data, `${folio}.pdf`);
}

// ── Recepciones (F9-PO-07) ────────────────────────────────────────────────

export async function listPurchaseReceipts(orderId: string): Promise<PurchaseReceipt[]> {
  const { data } = await api.get<PurchaseReceipt[]>(`/purchase-orders/${orderId}/receipts`);
  return data;
}

export async function getPurchaseReceipt(
  orderId: string,
  receiptId: string,
): Promise<PurchaseReceipt> {
  const { data } = await api.get<PurchaseReceipt>(
    `/purchase-orders/${orderId}/receipts/${receiptId}`,
  );
  return data;
}

/** Nace prellenada con lo pendiente de la orden. */
export async function createPurchaseReceipt(orderId: string): Promise<PurchaseReceipt> {
  const { data } = await api.post<PurchaseReceipt>(`/purchase-orders/${orderId}/receipts`, {});
  return data;
}

export async function updatePurchaseReceipt(
  orderId: string,
  receiptId: string,
  input: { receivedDate?: string; packingSlip?: string | null; notes?: string | null },
): Promise<PurchaseReceipt> {
  const { data } = await api.patch<PurchaseReceipt>(
    `/purchase-orders/${orderId}/receipts/${receiptId}`,
    input,
  );
  return data;
}

export async function replacePurchaseReceiptLines(
  orderId: string,
  receiptId: string,
  lines: PurchaseReceiptLineInput[],
): Promise<PurchaseReceipt> {
  const { data } = await api.put<PurchaseReceipt>(
    `/purchase-orders/${orderId}/receipts/${receiptId}/lines`,
    { lines },
  );
  return data;
}

export async function confirmPurchaseReceipt(
  orderId: string,
  receiptId: string,
): Promise<PurchaseReceipt> {
  const { data } = await api.post<PurchaseReceipt>(
    `/purchase-orders/${orderId}/receipts/${receiptId}/confirm`,
    {},
  );
  return data;
}

export async function cancelPurchaseReceipt(
  orderId: string,
  receiptId: string,
  reason: string,
): Promise<PurchaseReceipt> {
  const { data } = await api.post<PurchaseReceipt>(
    `/purchase-orders/${orderId}/receipts/${receiptId}/cancel`,
    { reason },
  );
  return data;
}

/** F9-PO-09: la compra nace de las recepciones confirmadas y sin factura. */
export async function createPurchaseFromReceipts(
  orderId: string,
  receiptIds: string[],
): Promise<Purchase> {
  const { data } = await api.post<Purchase>(`/purchase-orders/${orderId}/purchases`, {
    receiptIds,
  });
  return data;
}
