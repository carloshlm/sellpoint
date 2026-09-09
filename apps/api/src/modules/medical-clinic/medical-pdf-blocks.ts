import { formatAddress, type Locale, localeToBcp47 } from "@sellpoint/shared";
import type PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

/** Traduce una clave; lo inyecta el service con el locale del usuario. */
export type Translate = (key: string) => string;

/** Las fuentes estándar del visor, como en el PDF de inventario. */
export const FONTS = {
  Roboto: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

export const GRIS = "#666666";

/** El negocio, tal como lo deja imprimir su configuración del ticket (F4-TICKETCFG-07). */
export interface PdfTenant {
  name: string;
  legalName: string | null;
  address: string | null;
  phone: string | null;
  /** La del NEGOCIO: las fechas del papel se leen en su calendario. */
  timezone: string;
  showBusinessName: boolean;
  showAddress: boolean;
  showPhone: boolean;
}

/** El expediente que firma el papel. */
export interface PdfRecord {
  folio: string;
  /** `YYYY-MM-DD`, día del negocio. */
  consultationDate: string;
  patientName: string;
  age: number | null;
  sex: string | null;
  doctorName: string;
}

/**
 * F9-CLINIC-DOC-05 — los bloques que comparten TODOS los papeles clínicos
 * (la orden médica y las cartas): el encabezado del negocio, el bloque de
 * paciente y médico, la firma. Funciones puras que devuelven nodos de
 * pdfmake; cada renderer arma con ellas su `docDefinition` y se prueba
 * leyendo QUÉ dice el papel, no comparando bytes.
 */
export function fecha(value: Date, locale: Locale, timeZone: string): string {
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

/** Un día de calendario (`YYYY-MM-DD`) en palabras, sin que el huso lo corra. */
export function fechaDeCalendario(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(localeToBcp47(locale), {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
}

export const dato = (label: string, value: string | null) =>
  value === null || value === "" ? [] : [{ text: [{ text: `${label}: `, bold: true }, value] }];

export function encabezadoNegocio(tenant: PdfTenant, t: Translate) {
  return [
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
  ];
}

export function bloquePaciente(record: PdfRecord, t: Translate) {
  const edadYSexo = [
    record.age === null ? null : `${record.age} ${t("medical_clinic.pdf.years")}`,
    record.sex === null ? null : t(`medical_clinic.pdf.sex_${record.sex}`),
  ]
    .filter((v): v is string => v !== null)
    .join(" · ");
  return {
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
  };
}

export function firmaMedico(doctorName: string, t: Translate) {
  return {
    margin: [0, 48, 0, 0],
    columns: [
      { width: "*", text: "" },
      {
        width: 220,
        stack: [
          { text: "______________________________", alignment: "center" },
          { text: doctorName, alignment: "center", fontSize: 9 },
          {
            text: t("medical_clinic.pdf.signature"),
            alignment: "center",
            fontSize: 8,
            color: GRIS,
          },
        ],
      },
    ],
  };
}

/** F1-ADDR-07: la dirección en una línea, en el orden de su país. */
export function direccionEnLinea(tenant: {
  address: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}): string | null {
  const linea = formatAddress(
    {
      line1: tenant.address,
      line2: tenant.addressLine2,
      city: tenant.city,
      region: tenant.region,
      postalCode: tenant.postalCode,
    },
    tenant.country,
  );
  return linea === "" ? null : linea;
}

/** Del `docDefinition` al binario, con el mismo printer para todos los papeles. */
export function renderizar(printer: PdfPrinter, definition: unknown): Promise<Buffer> {
  const pdf = printer.createPdfKitDocument(definition as TDocumentDefinitions);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}
