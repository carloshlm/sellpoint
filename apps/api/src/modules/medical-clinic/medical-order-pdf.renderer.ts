import { type Locale, localeToBcp47 } from "@sellpoint/shared";

/** Traduce una clave; lo inyecta el service con el locale del usuario. */
export type Translate = (key: string) => string;

export interface MedicalOrderPdfInput {
  tenant: {
    name: string;
    legalName: string | null;
    address: string | null;
    phone: string | null;
    /** La del NEGOCIO: las fechas del papel se leen en su calendario. */
    timezone: string;
    /** F4-TICKETCFG-07 — qué del negocio se imprime; lo decide su configuración del ticket. */
    showBusinessName: boolean;
    showAddress: boolean;
    showPhone: boolean;
  };
  record: {
    folio: string;
    /** `YYYY-MM-DD`, día del negocio. */
    consultationDate: string;
    patientName: string;
    age: number | null;
    sex: string | null;
    doctorName: string;
  };
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

const GRIS = "#666666";

function fecha(value: Date, locale: Locale, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat(localeToBcp47(locale), {
      dateStyle: "short",
      timeStyle: "short",
      timeZone,
    })
      .format(value)
      .replace(",", "");
  } catch {
    return new Intl.DateTimeFormat(localeToBcp47(locale), {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "UTC",
    })
      .format(value)
      .replace(",", "");
  }
}

const dato = (label: string, value: string | null) =>
  value === null || value === "" ? [] : [{ text: [{ text: `${label}: `, bold: true }, value] }];

/**
 * F9-CLINIC-24 — el documento carta de una orden médica (receta, orden de
 * laboratorio, orden de estudios). Mismo molde que el PDF de inventario:
 * función pura que devuelve el `docDefinition`, para testear QUÉ dice el
 * papel y no comparar bytes. Se imprime se cobre o no: el ticket térmico es
 * de la caja; este papel es del paciente.
 */
export function buildMedicalOrderDefinition(input: MedicalOrderPdfInput, t: Translate) {
  const { tenant, record, order } = input;
  const esReceta = order.kind === "prescription";
  const edadYSexo = [
    record.age === null ? null : `${record.age} ${t("medical_clinic.pdf.years")}`,
    record.sex === null ? null : t(`medical_clinic.pdf.sex_${record.sex}`),
  ]
    .filter((v): v is string => v !== null)
    .join(" · ");

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
          {
            width: "*",
            stack: [
              ...(tenant.showBusinessName
                ? [{ text: tenant.legalName ?? tenant.name, bold: true, fontSize: 13 }]
                : []),
              ...(tenant.address === null || !tenant.showAddress
                ? []
                : [{ text: tenant.address, fontSize: 9, color: GRIS }]),
              ...(tenant.phone === null || !tenant.showPhone
                ? []
                : [
                    {
                      text: `${t("medical_clinic.pdf.phone")}: ${tenant.phone}`,
                      fontSize: 9,
                      color: GRIS,
                    },
                  ]),
            ],
          },
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
      {
        columns: [
          {
            width: "*",
            stack: [
              ...dato(t("medical_clinic.pdf.patient"), record.patientName),
              ...dato(t("medical_clinic.pdf.age_sex"), edadYSexo === "" ? null : edadYSexo),
              ...dato(t("medical_clinic.pdf.record"), record.folio),
            ],
            fontSize: 9,
          },
          {
            width: "*",
            stack: [
              ...dato(t("medical_clinic.pdf.doctor"), record.doctorName),
              ...dato(t("medical_clinic.pdf.consultation_date"), record.consultationDate),
            ],
            fontSize: 9,
          },
        ],
      },
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
      {
        margin: [0, 48, 0, 0],
        columns: [
          { width: "*", text: "" },
          {
            width: 220,
            stack: [
              { text: "______________________________", alignment: "center" },
              { text: record.doctorName, alignment: "center", fontSize: 9 },
              {
                text: t("medical_clinic.pdf.signature"),
                alignment: "center",
                fontSize: 8,
                color: GRIS,
              },
            ],
          },
        ],
      },
    ],
  };
}
