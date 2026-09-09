import type { Locale } from "@sellpoint/shared";
import {
  bloquePaciente,
  dato,
  encabezadoNegocio,
  fechaDeCalendario,
  firmaMedico,
  GRIS,
  type PdfRecord,
  type PdfTenant,
  type Translate,
} from "./medical-pdf-blocks";

export type MedicalLetterKind = "referral" | "interconsultation";

export interface MedicalLetterPdfInput {
  tenant: PdfTenant;
  record: PdfRecord;
  letter: {
    kind: MedicalLetterKind;
    /** 1-based: la posición dentro de la sección, lo que el médico ve en pantalla. */
    number: number;
    priority: "routine" | "urgent";
    facility: string | null;
    service: string;
    doctorName: string | null;
    reason: string;
    clinicalSummary: string | null;
    diagnosis: string | null;
    icd10Code: string | null;
    treatment: string | null;
  };
  locale: Locale;
}

/**
 * F9-CLINIC-DOC-05 — la carta: nota de referencia (NOM-004 6.4: el
 * establecimiento que envía es el negocio del encabezado; el receptor, el
 * motivo de envío, la impresión diagnóstica y la terapéutica empleada van en
 * el cuerpo) o solicitud de interconsulta (6.3). Función pura que devuelve
 * el `docDefinition`. Sin serie de folio: la identifica el folio del
 * expediente y su número, y la fecha es la de la consulta. Nada de dinero:
 * este papel es del paciente y del otro médico.
 */
export function buildMedicalLetterDefinition(input: MedicalLetterPdfInput, t: Translate) {
  const { tenant, record, letter } = input;
  const destinatario = [letter.facility, letter.service, letter.doctorName]
    .filter((v): v is string => v !== null && v !== "")
    .join(" · ");
  const diagnostico = [letter.icd10Code, letter.diagnosis]
    .filter((v): v is string => v !== null && v !== "")
    .join(" ");
  const parrafo = (titulo: string, texto: string | null) =>
    texto === null || texto === ""
      ? []
      : [{ margin: [0, 10, 0, 0], stack: [{ text: t(titulo), bold: true }, { text: texto }] }];

  return {
    pageSize: "LETTER" as const,
    pageMargins: [40, 40, 40, 40] as [number, number, number, number],
    defaultStyle: { font: "Roboto", fontSize: 10 },
    content: [
      {
        columns: [
          { width: "*", stack: encabezadoNegocio(tenant, t) },
          {
            width: "auto",
            alignment: "right",
            stack: [
              { text: t(`medical_clinic.pdf.title_${letter.kind}`), bold: true, fontSize: 12 },
              {
                text: `${record.folio} · ${t(`medical_clinic.pdf.letter_${letter.kind}`)} ${letter.number}`,
                fontSize: 11,
                bold: true,
              },
              {
                text: fechaDeCalendario(record.consultationDate, input.locale),
                fontSize: 9,
                color: GRIS,
              },
            ],
          },
        ],
      },
      { text: "", margin: [0, 8] },
      bloquePaciente(record, t),
      {
        margin: [0, 12, 0, 0],
        stack: [
          ...dato(t("medical_clinic.pdf.letter_to"), destinatario),
          ...dato(
            t("medical_clinic.pdf.priority"),
            t(`medical_clinic.pdf.priority_${letter.priority}`),
          ),
        ],
      },
      ...parrafo("medical_clinic.pdf.reason", letter.reason),
      ...parrafo("medical_clinic.pdf.clinical_summary", letter.clinicalSummary),
      ...parrafo("medical_clinic.pdf.diagnosis_icd10", diagnostico === "" ? null : diagnostico),
      ...parrafo("medical_clinic.pdf.treatment_given", letter.treatment),
      firmaMedico(record.doctorName, t),
    ],
  };
}
