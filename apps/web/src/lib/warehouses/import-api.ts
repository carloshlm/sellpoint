import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";
import type { ImportReport, ImportRunInput } from "@/lib/import/types";

/** Importación de ALMACENES por Excel (Carlos, 2026-09-01), match por código. */
export async function downloadWarehouseImportTemplate(): Promise<void> {
  const { data } = await api.get<Blob>("/warehouses/import/template", { responseType: "blob" });
  await descargarBlob(data, "almacenes.xlsx");
}

export async function runWarehouseImport(input: ImportRunInput): Promise<ImportReport> {
  const { data } = await api.post<ImportReport>("/warehouses/import", input);
  return data;
}
