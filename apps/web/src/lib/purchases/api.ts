import type { PurchaseStatus, PurchaseTaxMode } from "@sellpoint/shared";
import { api } from "@/lib/api";
import { imprimirPdf } from "@/lib/download";

/** Espejo de `PurchaseLineView` del API (F9-PURCH-05). */
export interface PurchaseLine {
  id: string;
  lineNo: number;
  productId: string;
  productSku: string;
  presentationId: string | null;
  presentationName: string | null;
  quantity: string | null;
  unitCost: string | null;
  /** El costo SIN impuesto, materializado al confirmar: el que cruza a la entrada. */
  unitCostNet: string | null;
  discount: string;
  taxGroupCode: string | null;
  taxAmount: string;
  lineTotal: string;
  lotCode: string | null;
  expiresAt: string | null;
  description: string;
  /** F9-PO-09: el hilo a la orden, el costo ACORDADO y la variación (facturado − acordado). */
  purchaseOrderLineId: string | null;
  orderedUnitCost: string | null;
  priceVariance: string | null;
}

export interface PurchaseCharge {
  id: string;
  lineNo: number;
  description: string;
  amount: string;
  taxGroupId: string | null;
  taxGroupCode: string | null;
  taxAmount: string;
  lineTotal: string;
}

export interface PurchaseRow {
  id: string;
  folio: string;
  status: PurchaseStatus;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  warehouseName: string;
  purchaseDate: string;
  receivedDate: string | null;
  supplierInvoice: string | null;
  declaredTotal: string | null;
  subtotal: string;
  discount: string;
  taxTotal: string;
  total: string;
  extraChargesTotal: string;
  taxMode: PurchaseTaxMode;
  notes: string | null;
  /** DERIVADO: el papel contra la suma de las líneas. Avisa, nunca bloquea. */
  mismatch: boolean;
  difference: string | null;
  lineCount: number;
  createdAt: string;
  confirmedAt: string | null;
  canceledAt: string | null;
  cancelReason: string | null;
}

/** El catálogo de lo que YA está en la compra: el selector y el aviso de lote. */
export interface PurchaseProduct {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  tracksLots: boolean;
  presentations: {
    id: string;
    name: string;
    factor: string;
    isPurchasable: boolean;
    cost?: string | null;
  }[];
}

export interface Purchase extends PurchaseRow {
  lines: PurchaseLine[];
  products: PurchaseProduct[];
  charges: PurchaseCharge[];
  taxes: { code: string; name: string; rate: string; base: string; amount: string }[];
  /** La entrada de inventario VIVA que nació de esta compra, si ya se pidió. */
  entry: { id: string; folio: string; status: string } | null;
  /** F9-PO-09: la orden de la que nació y las recepciones que factura. */
  order: { id: string; folio: string } | null;
  receipts: { id: string; folio: string }[];
  /** DERIVADO: alguna línea factura más de lo recibido. Avisa, no bloquea. */
  quantityVariance: boolean;
}

export interface PurchasesPage {
  rows: PurchaseRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Del FILTRO completo, no de la página, y sin las anuladas (F9-PURCH-13). */
  summary: { count: number; total: string; mismatchCount: number };
}

export interface ListPurchasesParams {
  query?: string;
  folio?: string;
  status?: PurchaseStatus;
  supplierId?: string;
  warehouseId?: string;
  purchaseOrderId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface UpdatePurchaseInput {
  supplierId?: string;
  warehouseId?: string;
  purchaseDate?: string;
  receivedDate?: string | null;
  supplierInvoice?: string | null;
  declaredTotal?: number | null;
  taxMode?: PurchaseTaxMode;
  notes?: string | null;
}

export interface PurchaseLineInput {
  productId: string;
  presentationId?: string | null;
  quantity?: number | null;
  unitCost?: number | null;
  discount?: number;
  taxGroupId?: string | null;
  lotCode?: string | null;
  expiresAt?: string | null;
  purchaseOrderLineId?: string | null;
}

export interface PurchaseChargeInput {
  description: string;
  amount: number;
  taxGroupId?: string | null;
}

/** Solo viajan los filtros con valor: un `from: ""` haría que el API rechace la consulta. */
function limpiar<T extends object>(params: T): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== null),
  ) as Record<string, string | number>;
}

export async function listPurchases(params: ListPurchasesParams = {}): Promise<PurchasesPage> {
  const { data } = await api.get<PurchasesPage>("/purchases", { params: limpiar(params) });
  return data;
}

export async function getPurchase(id: string): Promise<Purchase> {
  const { data } = await api.get<Purchase>(`/purchases/${id}`);
  return data;
}

export async function createPurchase(input: {
  supplierId: string;
  purchaseDate: string;
  warehouseId?: string;
}): Promise<Purchase> {
  const { data } = await api.post<Purchase>("/purchases", input);
  return data;
}

export async function updatePurchase(id: string, input: UpdatePurchaseInput): Promise<Purchase> {
  const { data } = await api.patch<Purchase>(`/purchases/${id}`, input);
  return data;
}

/** Lo único editable de una confirmada: cuándo llegó y con qué papel. */
export async function updateReception(
  id: string,
  input: { receivedDate?: string | null; supplierInvoice?: string | null; notes?: string | null },
): Promise<Purchase> {
  const { data } = await api.patch<Purchase>(`/purchases/${id}/reception`, input);
  return data;
}

export async function replacePurchaseLines(
  id: string,
  lines: PurchaseLineInput[],
): Promise<Purchase> {
  const { data } = await api.put<Purchase>(`/purchases/${id}/lines`, { lines });
  return data;
}

export async function replacePurchaseCharges(
  id: string,
  charges: PurchaseChargeInput[],
): Promise<Purchase> {
  const { data } = await api.put<Purchase>(`/purchases/${id}/charges`, { charges });
  return data;
}

export async function confirmPurchase(id: string): Promise<Purchase> {
  const { data } = await api.post<Purchase>(`/purchases/${id}/confirm`, {});
  return data;
}

export async function cancelPurchase(id: string, reason: string): Promise<Purchase> {
  const { data } = await api.post<Purchase>(`/purchases/${id}/cancel`, { reason });
  return data;
}

/** El puente: abre (o devuelve) el borrador de entrada de inventario. */
export async function createEntryDraft(
  id: string,
): Promise<{ id: string; folio: string; status: string }> {
  const { data } = await api.post<{ id: string; folio: string; status: string }>(
    `/purchases/${id}/entry-draft`,
    {},
  );
  return data;
}

/** El papel de la compra, directo al cuadro de impresión. */
export async function printPurchase(id: string, folio: string): Promise<void> {
  const { data } = await api.get<Blob>(`/purchases/${id}/document`, { responseType: "blob" });
  imprimirPdf(data, `${folio}.pdf`);
}
