import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";
import { readFileAsBase64 } from "@/lib/import/read-file";
import type { ImportReport, ImportRunInput } from "@/lib/import/types";

/** El reporte del importador de servicios — la forma común de toda importación. */
export type ServiceImportReport = ImportReport;

/**
 * Importación de SERVICIOS, solo Excel (Carlos, 2026-09-01). El binario viaja
 * en base64 dentro del JSON — mismo transporte que productos.
 */
export async function readServiceImportFile(file: File): Promise<string> {
  return readFileAsBase64(file);
}

export async function downloadServiceImportTemplate(): Promise<void> {
  const { data } = await api.get<Blob>("/services/import/template", { responseType: "blob" });
  await descargarBlob(data, "servicios.xlsx");
}

export async function runServiceImport(input: ImportRunInput): Promise<ServiceImportReport> {
  const { data } = await api.post<ServiceImportReport>("/services/import", input);
  return data;
}
