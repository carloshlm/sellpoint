import { api } from "@/lib/api";
import type {
  DocumentDetail,
  DocumentPage,
  DocumentSummary,
  ExpiringRow,
  InventoryDocumentType,
  ListDocumentsParams,
  MovementReason,
  UpsertLineInput,
} from "./types";

export async function listExpiring(params: {
  days: number;
  warehouseId?: string;
}): Promise<ExpiringRow[]> {
  const { data } = await api.get<ExpiringRow[]>("/inventory/expiring", { params });
  return data;
}

export async function listDocuments(params: ListDocumentsParams): Promise<DocumentPage> {
  const { data } = await api.get<DocumentPage>("/inventory/documents", { params });
  return data;
}

export async function getDocument(id: string): Promise<DocumentDetail> {
  const { data } = await api.get<DocumentDetail>(`/inventory/documents/${id}`);
  return data;
}

/** Crea el borrador y devuelve su folio: la pantalla navega al id que sale acá. */
export async function createDocument(input: {
  type: InventoryDocumentType;
  warehouseId: string;
}): Promise<DocumentSummary> {
  const { data } = await api.post<DocumentSummary>("/inventory/documents", input);
  return data;
}

export async function updateDocumentHeader(
  id: string,
  input: {
    reasonCode?: MovementReason;
    reference?: string | null;
    reasonNote?: string | null;
    authorizedBy?: string | null;
    linkedWarehouseId?: string | null;
  },
): Promise<DocumentSummary> {
  const { data } = await api.patch<DocumentSummary>(`/inventory/documents/${id}`, input);
  return data;
}

export async function cancelDocument(id: string, reason?: string): Promise<DocumentSummary> {
  const { data } = await api.post<DocumentSummary>(`/inventory/documents/${id}/cancel`, { reason });
  return data;
}

export async function confirmDocument(id: string): Promise<{ document: DocumentSummary }> {
  const { data } = await api.post<{ document: DocumentSummary }>(
    `/inventory/documents/${id}/confirm`,
    {},
  );
  return data;
}

export async function addDocumentLine(id: string, input: UpsertLineInput) {
  const { data } = await api.post(`/inventory/documents/${id}/lines`, input);
  return data;
}

export async function updateDocumentLine(
  id: string,
  lineId: string,
  input: Partial<UpsertLineInput>,
) {
  const { data } = await api.patch(`/inventory/documents/${id}/lines/${lineId}`, input);
  return data;
}

export async function removeDocumentLine(id: string, lineId: string): Promise<void> {
  await api.delete(`/inventory/documents/${id}/lines/${lineId}`);
}

/**
 * La plantilla de conteo, POBLADA con el teórico de ese almacén.
 *
 * Siempre como `blob`: el XLSX es binario y pedirlo como texto lo corrompe
 * (misma razón que `downloadImportTemplate` de productos).
 */
export async function downloadCountTemplate(
  warehouseId: string,
  format: "csv" | "xlsx" = "xlsx",
): Promise<void> {
  const { data } = await api.get<Blob>("/inventory/documents/template", {
    params: { type: "physical_count", warehouseId, format },
    responseType: "blob",
  });

  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `conteo-fisico.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importDocumentLines(
  id: string,
  input: { file: string; format: "csv" | "xlsx"; mode: "replace" | "append" },
) {
  const { data } = await api.post(`/inventory/documents/${id}/lines/import`, input);
  return data;
}

/**
 * Baja el PDF. Con axios y `responseType: 'blob'` —no con un `<a href>`—
 * porque el endpoint exige el Bearer y un link plano iría sin token: mismo
 * motivo que `downloadImportTemplate` de productos.
 */
export async function downloadDocumentPdf(id: string, folio: string): Promise<void> {
  const { data } = await api.get<Blob>(`/inventory/documents/${id}/pdf`, {
    responseType: "blob",
  });

  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${folio}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}
