import { api } from "@/lib/api";
import { descargarBlob } from "@/lib/download";
import { readFileAsBase64 } from "@/lib/import/read-file";
import type { ImportReport, ImportRunInput } from "@/lib/import/types";
import type { StudyKind } from "./api";

/** El reporte del importador de estudios — la forma común de toda importación. */
export type StudyImportReport = ImportReport;

/** `lab` → `/medical-clinic/lab-studies`, `diagnostic` → `/medical-clinic/diagnostic-studies`. */
const base = (kind: StudyKind) =>
  kind === "lab" ? "/medical-clinic/lab-studies" : "/medical-clinic/diagnostic-studies";

/**
 * Importación de ESTUDIOS desde Excel, con el mismo transporte que servicios:
 * el binario en base64 dentro del JSON (Carlos, 2026-09-04).
 */
export async function readStudyImportFile(file: File): Promise<string> {
  return readFileAsBase64(file);
}

export function downloadStudyImportTemplate(kind: StudyKind): () => Promise<void> {
  return async () => {
    const { data } = await api.get<Blob>(`${base(kind)}/import/template`, {
      responseType: "blob",
    });
    await descargarBlob(
      data,
      kind === "lab" ? "estudios-laboratorio.xlsx" : "estudios-diagnosticos.xlsx",
    );
  };
}

export function runStudyImport(
  kind: StudyKind,
): (input: ImportRunInput) => Promise<StudyImportReport> {
  return async (input) => {
    const { data } = await api.post<StudyImportReport>(`${base(kind)}/import`, input);
    return data;
  };
}
