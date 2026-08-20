import type { InventoryDocumentType } from "@sellpoint/shared";

/** Traduce una clave; lo inyecta el service con el locale del usuario. */
export type Translate = (key: string) => string;

export interface PdfRow {
  lineNo: number;
  sku: string;
  name: string;
  presentationName: string | null;
  quantityInput: string | null;
  quantityBase: string | null;
  baseUnit: string;
  unitCost: string | null;
  lotCode: string | null;
  expiresAt: Date | string | null;
  location: string | null;
  theoretical: string | null;
  counted: string | null;
}

export interface PdfDocumentInput {
  tenant: { name: string; legalName: string | null; taxId: string | null };
  document: {
    folio: string;
    type: InventoryDocumentType;
    status: "draft" | "confirmed" | "canceled";
    warehouseName: string;
    linkedWarehouseName: string | null;
    reasonCode: string | null;
    reference: string | null;
    reasonNote: string | null;
    createdAt: Date;
    createdByName: string;
    authorizedByName: string | null;
  };
  rows: PdfRow[];
}

const GRIS = "#666666";

const fecha = (value: Date): string =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" })
    .format(value)
    .replace(",", "");

const dato = (label: string, value: string | null) =>
  value === null || value === "" ? [] : [{ text: [{ text: `${label}: `, bold: true }, value] }];

/**
 * F3-DOC-07 — el papel que alguien firma.
 *
 * Devuelve el `docDefinition` de `pdfmake` y no un binario, para que se pueda
 * testear QUÉ dice el documento en vez de comparar bytes.
 *
 * ── Por qué `pdfmake` y no `pdfkit` ─────────────────────────────────────
 *
 * Un inventario físico son 500 líneas. `pdfmake` **pagina la tabla solo y
 * repite el encabezado** en cada hoja (`headerRows`); con `pdfkit` habría que
 * llevar la cuenta del alto disponible a mano y decidir dónde cortar.
 *
 * ── El pie NO lleva un total de unidades ────────────────────────────────
 *
 * Sumar 36 unidades + 2.5 kg + 400 ml da 438.5 de nada. Se cuentan **líneas**,
 * y la cantidad va por línea con su unidad. Un total que miente es peor que no
 * tenerlo — y en un papel firmado, mucho peor.
 */
export function buildDocumentDefinition(input: PdfDocumentInput, t: Translate) {
  const { tenant, document, rows } = input;
  const esConteo = document.type === "physical_count";
  const muestraCosto = document.reasonCode === "invoice";
  const conLotes = rows.some((r) => r.lotCode !== null);

  const encabezado = esConteo
    ? [
        "#",
        t("pdf.sku"),
        t("pdf.product"),
        t("pdf.theoretical"),
        t("pdf.counted"),
        t("pdf.difference"),
      ]
    : [
        "#",
        t("pdf.sku"),
        t("pdf.product"),
        t("pdf.presentation"),
        t("pdf.quantity"),
        ...(conLotes ? [t("pdf.lot")] : []),
        ...(muestraCosto ? [t("pdf.unitCost")] : []),
      ];

  const cuerpo = rows.map((row) => {
    if (esConteo) {
      const teorico = Number(row.theoretical ?? 0);
      const contado = Number(row.counted ?? 0);
      return [
        String(row.lineNo),
        row.sku,
        row.name,
        row.theoretical ?? "",
        row.counted ?? "",
        String(contado - teorico),
      ];
    }

    // "3 Caja ×12 = 36 unit": lo que el usuario tecleó Y su equivalencia, para
    // que quien recibe pueda contar sin hacer la cuenta.
    const cantidad =
      row.presentationName === null
        ? `${row.quantityBase ?? ""} ${row.baseUnit}`
        : `${row.quantityInput ?? ""} = ${row.quantityBase ?? ""} ${row.baseUnit}`;

    return [
      String(row.lineNo),
      row.sku,
      row.name,
      row.presentationName ?? "—",
      cantidad,
      ...(conLotes
        ? [
            [row.lotCode, row.expiresAt ? String(row.expiresAt).slice(0, 10) : null, row.location]
              .filter(Boolean)
              .join(" · ") || "—",
          ]
        : []),
      ...(muestraCosto ? [row.unitCost ?? ""] : []),
    ];
  });

  const anchos = esConteo
    ? ["auto", "auto", "*", "auto", "auto", "auto"]
    : [
        "auto",
        "auto",
        "*",
        "auto",
        "auto",
        ...(conLotes ? ["auto"] : []),
        ...(muestraCosto ? ["auto"] : []),
      ];

  return {
    pageSize: "LETTER",
    pageMargins: [40, 40, 40, 40],
    // Un borrador impreso por error no puede parecer un documento asentado.
    ...(document.status !== "confirmed" && {
      watermark: {
        text: t(document.status === "draft" ? "pdf.watermarkDraft" : "pdf.watermarkCanceled"),
        opacity: 0.15,
        bold: true,
      },
    }),
    content: [
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: tenant.legalName ?? tenant.name, bold: true, fontSize: 12 },
              ...(tenant.taxId === null
                ? []
                : [{ text: `${t("pdf.taxId")}: ${tenant.taxId}`, fontSize: 9, color: GRIS }]),
            ],
          },
          {
            width: "auto",
            alignment: "right",
            stack: [
              { text: t(`pdf.type.${document.type}`), bold: true, fontSize: 12 },
              { text: document.folio, fontSize: 14, bold: true },
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
              ...dato(t("pdf.warehouse"), document.warehouseName),
              // El OTRO almacén cambia de nombre según el lado del traspaso:
              // en una SALIDA es a dónde va la mercancía; en una ENTRADA es de
              // dónde vino. Llamarlo "destino" en los dos casos —como se
              // hacía— le decía a quien recibe en Almacén Sur que su destino
              // era Almacén Central. Mismo criterio que la pantalla del
              // documento, que se corrigió antes que esto.
              ...dato(
                t(document.type === "entry" ? "pdf.origin" : "pdf.destination"),
                document.linkedWarehouseName,
              ),
              ...dato(
                t("pdf.reasonLabel"),
                document.reasonCode === null ? null : t(`pdf.reason.${document.reasonCode}`),
              ),
            ],
            fontSize: 9,
          },
          {
            width: "*",
            stack: [
              ...dato(t("pdf.date"), fecha(document.createdAt)),
              ...dato(t("pdf.registeredBy"), document.createdByName),
              ...dato(t("pdf.reference"), document.reference),
              ...dato(t("pdf.authorizedBy"), document.authorizedByName),
            ],
            fontSize: 9,
          },
        ],
      },
      ...(document.reasonNote === null
        ? []
        : [{ text: document.reasonNote, fontSize: 9, italics: true, margin: [0, 6, 0, 0] }]),
      { text: "", margin: [0, 8] },
      {
        table: {
          // Repite el encabezado en cada hoja: un conteo de 500 líneas ocupa
          // varias y nadie debería tener que volver a la primera para saber
          // qué columna es cuál.
          headerRows: 1,
          widths: anchos,
          body: [encabezado, ...cuerpo],
        },
        layout: "lightHorizontalLines",
        fontSize: 9,
      },
      {
        text: `${t("pdf.totalLines")}: ${rows.length}`,
        bold: true,
        fontSize: 9,
        margin: [0, 10, 0, 0],
      },
      {
        columns: [t("pdf.deliveredBy"), t("pdf.receivedBy"), t("pdf.authorizedBy")].map(
          (label) => ({
            width: "*",
            alignment: "center",
            stack: [
              { text: "", margin: [0, 28] },
              { text: "____________________", color: GRIS },
              { text: label, fontSize: 8, color: GRIS },
            ],
          }),
        ),
        margin: [0, 24, 0, 0],
      },
    ],
    defaultStyle: { fontSize: 10 },
  };
}
