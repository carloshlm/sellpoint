import { api } from "@/lib/api";
import { descargarBlob, nombreDeDescarga } from "@/lib/download";
import type { ImportReport, ImportRunInput } from "@/lib/import/types";

/** Importación de PROVEEDORES por Excel (Carlos, 2026-09-12), match por código. */
export async function downloadSupplierImportTemplate(): Promise<void> {
  const { data, headers } = await api.get<Blob>("/suppliers/import/template", {
    responseType: "blob",
  });
  await descargarBlob(data, nombreDeDescarga(headers, "proveedores.xlsx"));
}

export async function runSupplierImport(input: ImportRunInput): Promise<ImportReport> {
  const { data } = await api.post<ImportReport>("/suppliers/import", input);
  return data;
}
