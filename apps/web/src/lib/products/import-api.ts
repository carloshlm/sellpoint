import { api } from "@/lib/api";

export interface ImportRowError {
  row: number;
  message: string;
  field?: string;
}

export interface ImportReport {
  valid: number;
  failed: number;
  errors: ImportRowError[];
  imported: number;
}

export interface RunImportInput {
  content: string;
  dryRun?: boolean;
  skipErrors?: boolean;
}

export async function runImport(input: RunImportInput): Promise<ImportReport> {
  const { data } = await api.post<ImportReport>("/products/import", {
    content: input.content,
    dryRun: input.dryRun ?? false,
    skipErrors: input.skipErrors ?? false,
  });
  return data;
}

/**
 * Descarga la plantilla. Se pide con axios (y no con un `<a href>`) porque el
 * endpoint exige el Bearer: un link plano iría sin token y devolvería 401.
 */
export async function downloadImportTemplate(): Promise<void> {
  const { data } = await api.get<string>("/products/import/template", {
    responseType: "text",
  });

  const url = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "productos.csv";
  link.click();
  URL.revokeObjectURL(url);
}
