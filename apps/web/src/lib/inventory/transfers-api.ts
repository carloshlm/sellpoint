import { api } from "@/lib/api";

/**
 * Espejo de `TransfersService`. El traspaso NO tiene folio propio: el que se
 * muestra es el de su documento de DESPACHO, un `SAL-…`.
 */
export interface TransferRow {
  id: string;
  documentId: string | null;
  folio: string | null;
  status: "in_transit" | "completed" | "canceled";
  origin: { id: string; name: string };
  destination: { id: string; name: string };
  createdAt: string;
  createdBy: { id: string; name: string };
  /**
   * El borrador de recepción, si alguien ya lo abrió.
   *
   * Que exista NO cierra el traspaso: sigue en tránsito hasta que esa entrada
   * se confirme, porque hasta entonces nadie contó lo que llegó. Sirve para
   * que el botón deje de decir "Recibir" cuando la recepción ya empezó.
   */
  receipt: { id: string; folio: string } | null;
  lineCount: number;
  daysInTransit: number;
  /** Más de una semana en viaje: el aviso de "revisá si llegó". */
  isStale: boolean;
  /** La historia de la cancelación: `null` mientras el traspaso viva. */
  canceledAt: string | null;
  cancelReason: string | null;
  canceledBy: { id: string; name: string } | null;
}

export interface TransferPage {
  rows: TransferRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Los contadores de los tres tabs, ya acotados al alcance del usuario. */
  meta: { incomingCount: number; outgoingCount: number; canceledCount: number };
}

export interface TransferLineDetail {
  id: string;
  productId: string;
  sku: string;
  name: string;
  baseUnit: string;
  lot: { id: string; lotCode: string; expiresAt: string | null } | null;
  quantitySent: string;
  /** `null` hasta que alguien recibe. NO es lo mismo que recibir 0. */
  quantityReceived: string | null;
  difference: string | null;
}

export interface TransferDetail {
  id: string;
  documentId: string | null;
  folio: string | null;
  status: TransferRow["status"];
  origin: { id: string; name: string };
  destination: { id: string; name: string };
  createdAt: string;
  createdBy: { id: string; name: string };
  receivedAt: string | null;
  receivedBy: { id: string; name: string } | null;
  canceledAt: string | null;
  canceledBy: { id: string; name: string } | null;
  cancelReason: string | null;
  discrepancyNote: string | null;
  lines: TransferLineDetail[];
}

export interface ListTransfersParams {
  status?: TransferRow["status"];
  direction?: "incoming" | "outgoing";
  originWarehouseId?: string;
  destinationWarehouseId?: string;
  /** Origen O destino: el filtro «Almacén» de la pestaña Cancelados. */
  warehouseId?: string;
  folio?: string;
  from?: string;
  to?: string;
  olderThanDays?: number;
  page?: number;
  pageSize?: number;
}

export async function listTransfers(params: ListTransfersParams): Promise<TransferPage> {
  const { data } = await api.get<TransferPage>("/transfers", { params });
  return data;
}

export async function getTransfer(id: string): Promise<TransferDetail> {
  const { data } = await api.get<TransferDetail>(`/transfers/${id}`);
  return data;
}

/** Crea (o devuelve, es idempotente) el borrador de Entrada de la recepción. */
export async function createReceiptDraft(id: string): Promise<{ id: string; folio: string }> {
  const { data } = await api.post<{ id: string; folio: string }>(`/transfers/${id}/receipt-draft`);
  return data;
}

export async function cancelTransfer(id: string, reason: string): Promise<void> {
  await api.post(`/transfers/${id}/cancel`, { reason });
}
