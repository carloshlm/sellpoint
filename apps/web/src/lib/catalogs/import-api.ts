import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";
import type { ImportReport, ImportRunInput } from "@/lib/import/types";

/**
 * Importación de registros de un SUBCATÁLOGO por Excel (Carlos, 2026-09-01),
 * match por código. Parametrizada por catálogo: la misma pantalla sirve a
 * laboratorios, proveedores o lo que el negocio haya definido.
 */
export async function downloadRecordsImportTemplate(catalogId: string): Promise<void> {
  const { data } = await api.get<Blob>(`/catalogs/${catalogId}/records/import/template`, {
    responseType: "blob",
  });
  await descargarBlob(data, "registros.xlsx");
}

export async function runRecordsImport(
  catalogId: string,
  input: ImportRunInput,
): Promise<ImportReport> {
  const { data } = await api.post<ImportReport>(`/catalogs/${catalogId}/records/import`, input);
  return data;
}
