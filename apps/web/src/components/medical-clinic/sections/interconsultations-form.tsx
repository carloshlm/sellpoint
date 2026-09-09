import { LetterSectionForm } from "./letter-section-form";
import type { SectionFormProps } from "./registry";

/**
 * F9-CLINIC-DOC-04 — Interconsultas: la SOLICITUD de interconsulta
 * (NOM-004 6.3). La solicitud la hace el médico tratante y el paciente
 * sigue bajo su cuidado; la NOTA de interconsulta la elabora el consultado
 * y se transcribe en Notas Médicas como «Respuesta de especialista» el día
 * que llega. Por eso la unidad es opcional: a veces solo se pide la
 * especialidad.
 */
export function InterconsultationsForm(props: SectionFormProps) {
  return <LetterSectionForm variant="interconsultation" {...props} />;
}
