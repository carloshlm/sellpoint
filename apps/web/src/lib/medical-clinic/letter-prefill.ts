import type { RecordSection } from "./api";

export interface LetterPrefill {
  clinicalSummary: string | null;
  diagnosis: string | null;
  icd10Code: string | null;
  treatment: string | null;
}

const texto = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

function datosDe(sections: readonly RecordSection[], key: string): Record<string, unknown> {
  const data = sections.find((s) => s.key === key)?.data;
  return data && typeof data === "object" ? data : {};
}

/** El diagnóstico principal de Diagnósticos (o el primero, si ninguno es principal). */
export function primaryDiagnosis(
  sections: readonly RecordSection[],
): { description: string; icd10Code: string | null } | null {
  const items = datosDe(sections, "diagnoses").items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const filas = items as Record<string, unknown>[];
  const principal = filas.find((d) => d.role === "primary") ?? filas[0];
  const description = principal ? texto(principal.description) : null;
  if (description === null) return null;
  return { description, icd10Code: principal ? texto(principal.icd10Code) : null };
}

/**
 * F9-CLINIC-DOC-03 — «Traer del expediente»: lo que la NOM-004 6.4 pide en
 * el resumen clínico ya se capturó en otras tarjetas. Cada campo de la
 * carta se llena desde la suya: el resumen con el padecimiento actual (o
 * el motivo de consulta si no hay), la impresión diagnóstica con el
 * diagnóstico principal y su CIE-10, la terapéutica con el tratamiento
 * farmacológico. Devuelve null por campo cuando no hay nada que traer;
 * quién decide no pisar lo ya escrito es el formulario.
 */
export function letterPrefill(sections: readonly RecordSection[]): LetterPrefill {
  const dx = primaryDiagnosis(sections);
  return {
    clinicalSummary:
      texto(datosDe(sections, "current_illness").narrative) ??
      texto(datosDe(sections, "chief_complaint").complaint),
    diagnosis: dx?.description ?? null,
    icd10Code: dx?.icd10Code ?? null,
    treatment: texto(datosDe(sections, "treatment").pharmacological),
  };
}
