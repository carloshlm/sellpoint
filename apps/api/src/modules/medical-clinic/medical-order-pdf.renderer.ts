import type { Locale } from "@sellpoint/shared";
import {
  bloquePaciente,
  encabezadoNegocio,
  fecha,
  firmaMedico,
  GRIS,
  type PdfRecord,
  type PdfTenant,
  type Translate,
} from "./medical-pdf-blocks";

export type { Translate } from "./medical-pdf-blocks";

export interface MedicalOrderPdfInput {
  tenant: PdfTenant;
  record: PdfRecord;
  order: {
    kind: "prescription" | "lab_order" | "diagnostic_order";
    folio: string;
    createdAt: Date;
    diagnosis: string | null;
    indications: string | null;
    lines: { description: string; quantity: string; dosage: string | null }[];
  };
  locale: Locale;
}

/**
 * F9-CLINIC-24 — el documento carta de una orden médica (receta, orden de
 * laboratorio, orden de estudios). Mismo molde que el PDF de inventario:
 * función pura que devuelve el `docDefinition`, para testear QUÉ dice el
 * papel y no comparar bytes. Se imprime se cobre o no: el ticket térmico es
 * de la caja; este papel es del paciente. Los bloques comunes (negocio,
 * paciente, firma) viven en `medical-pdf-blocks.ts` y los comparte con las
 * cartas (F9-CLINIC-DOC-05).
 */
export function buildMedicalOrderDefinition(input: MedicalOrderPdfInput, t: Translate) {
  const { tenant, record, order } = input;
  const esReceta = order.kind === "prescription";

  const encabezadoTabla = [
    { text: t("medical_clinic.pdf.item"), bold: true },
    { text: t("medical_clinic.pdf.quantity"), bold: true, alignment: "right" },
    ...(esReceta ? [{ text: t("medical_clinic.pdf.dosage"), bold: true }] : []),
  ];
  const filas = order.lines.map((l) => [
    l.description,
    { text: l.quantity, alignment: "right" },
    ...(esReceta ? [l.dosage ?? ""] : []),
  ]);

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
              { text: t(`medical_clinic.pdf.title_${order.kind}`), bold: true, fontSize: 12 },
              { text: order.folio, fontSize: 14, bold: true },
              {
                text: fecha(order.createdAt, input.locale, tenant.timezone),
                fontSize: 9,
                color: GRIS,
              },
            ],
          },
        ],
      },
      { text: "", margin: [0, 8] },
      bloquePaciente(record, t),
      ...(order.diagnosis === null
        ? []
        : [
            {
              text: [
                { text: `${t("medical_clinic.pdf.diagnosis")}: `, bold: true },
                order.diagnosis,
              ],
              margin: [0, 10, 0, 0],
            },
          ]),
      {
        margin: [0, 12, 0, 0],
        table: {
          headerRows: 1,
          widths: esReceta ? ["*", "auto", "*"] : ["*", "auto"],
          body: [encabezadoTabla, ...filas],
        },
        layout: "lightHorizontalLines",
        fontSize: 9,
      },
      ...(order.indications === null
        ? []
        : [
            {
              margin: [0, 12, 0, 0],
              stack: [
                { text: t("medical_clinic.pdf.indications"), bold: true },
                { text: order.indications },
              ],
            },
          ]),
      firmaMedico(record.doctorName, t),
    ],
  };
}
