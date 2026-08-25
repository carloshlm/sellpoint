import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";

export type ImportFormat = "csv" | "xlsx";

export interface ImportRowError {
  row: number;
  message: string;
  field?: string;
}

export interface ImportReport {
  valid: number;
  failed: number;
  errors: ImportRowError[];
  /** Filas que dan de alta un producto nuevo. */
  created: number;
  /** Filas cuyo SKU ya existe: se actualizan (la plantilla trae lo existente). */
  updated: number;
  imported: number;
}

export interface RunImportInput {
  content: string;
  format?: ImportFormat;
  dryRun?: boolean;
  skipErrors?: boolean;
}

export async function runImport(input: RunImportInput): Promise<ImportReport> {
  const { data } = await api.post<ImportReport>("/products/import", {
    content: input.content,
    format: input.format ?? "csv",
    dryRun: input.dryRun ?? false,
    skipErrors: input.skipErrors ?? false,
  });
  return data;
}

/** El formato sale de la extensión; un archivo sin extensión conocida se trata como CSV. */
export function formatFromFileName(name: string): ImportFormat {
  return name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
}

/**
 * Lee el archivo en la forma que espera el API: texto para CSV, base64 para
 * XLSX (es binario y viaja dentro de un JSON).
 */
export async function readImportFile(
  file: File,
): Promise<{ content: string; format: ImportFormat }> {
  const format = formatFromFileName(file.name);
  if (format === "csv") {
    return { content: await file.text(), format };
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  // En trozos: `String.fromCharCode(...arr)` con un archivo de MB revienta el
  // stack por cantidad de argumentos.
  let binary = "";
  const CHUNK = 0x8000;
  for (let index = 0; index < buffer.length; index += CHUNK) {
    binary += String.fromCharCode(...buffer.subarray(index, index + CHUNK));
  }
  return { content: btoa(binary), format };
}

/**
 * Descarga la plantilla. Se pide con axios (y no con un `<a href>`) porque el
 * endpoint exige el Bearer: un link plano iría sin token y devolvería 401.
 *
 * Siempre como `blob`: el XLSX es binario y pedirlo como texto lo corrompe.
 */
export async function downloadImportTemplate(format: ImportFormat = "csv"): Promise<void> {
  const { data } = await api.get<Blob>("/products/import/template", {
    params: { format },
    responseType: "blob",
  });

  await descargarBlob(data, `productos.${format}`);
}
