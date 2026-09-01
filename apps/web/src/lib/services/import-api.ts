import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";

/** El reporte del importador de servicios — espejo del de productos. */
export interface ServiceImportReport {
  valid: number;
  failed: number;
  created: number;
  updated: number;
  errors: {
    row: number;
    field?: string;
    message: string;
    translated?: string;
    /** El código de la fila, si lo trae: para encontrarla en el Excel sin contar renglones. */
    itemCode?: string;
  }[];
  applied: boolean;
}

/**
 * Importación de SERVICIOS, solo Excel (Carlos, 2026-09-01). El binario viaja
 * en base64 dentro del JSON — mismo transporte que productos.
 */
export async function readServiceImportFile(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  // En trozos: `String.fromCharCode(...arr)` con un archivo de MB revienta
  // el stack por cantidad de argumentos.
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < buffer.length; index += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

export async function downloadServiceImportTemplate(): Promise<void> {
  const { data } = await api.get<Blob>("/services/import/template", { responseType: "blob" });
  await descargarBlob(data, "servicios.xlsx");
}

export async function runServiceImport(input: {
  content: string;
  dryRun?: boolean;
  skipErrors?: boolean;
}): Promise<ServiceImportReport> {
  const { data } = await api.post<ServiceImportReport>("/services/import", input);
  return data;
}
