import { LetterSectionForm } from "./letter-section-form";
import type { SectionFormProps } from "./registry";

/**
 * F9-CLINIC-DOC-03 — Referencias: la nota de referencia (NOM-004 6.4). El
 * establecimiento que envía es el negocio (va en el encabezado del papel);
 * aquí se captura el receptor, el motivo de envío, el resumen clínico, la
 * impresión diagnóstica y la terapéutica empleada. La contrarreferencia que
 * traiga el paciente se registra en Notas Médicas el día que llegue.
 */
export function ReferralsForm(props: SectionFormProps) {
  return <LetterSectionForm variant="referral" {...props} />;
}
