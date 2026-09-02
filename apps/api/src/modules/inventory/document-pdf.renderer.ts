import {
  effectiveDocumentDate,
  formatQuantity,
  formatQuantityWithUnit,
  type InventoryDocumentType,
  type Locale,
  localCalendarDate,
  localeToBcp47,
} from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";

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
  /** `timezone` es la del NEGOCIO: las fechas del papel se leen en su calendario. */
  tenant: { name: string; legalName: string | null; taxId: string | null; timezone: string };
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
    confirmedAt: Date | null;
    canceledAt: Date | null;
    createdByName: string;
    authorizedByName: string | null;
  };
  rows: PdfRow[];
  /**
   * El idioma del usuario que pidió el PDF (F4-TICKET-03).
   *
   * Va aparte de `t` porque `t` solo traduce CLAVES, y el nombre de una unidad
   * no es una clave del namespace `pdf`: vive en `UNITS` de `@sellpoint/shared`,
   * la misma tabla que alimenta al catálogo y a la pantalla. Duplicarlo como
   * `pdf.unit.kg` sería tener el nombre de un kilo en dos lugares.
   */
  locale: Locale;
}

const GRIS = "#666666";

/**
 * Un instante del documento, en la zona del negocio y en el idioma de quien
 * imprime (Carlos, 2026-09-02). Salía en `es-MX` y UTC fijos: un conteo
 * asentado a las 7 de la noche de CDMX decía «mañana».
 */
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
    // Una zona mal cargada no puede dejar sin PDF a nadie: cae a UTC.
    return new Intl.DateTimeFormat(localeToBcp47(locale), {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "UTC",
    })
      .format(value)
      .replace(",", "");
  }
}

const MESES: Record<Locale, readonly string[]> = {
  es: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/**
 * La caducidad de un lote: «2026 Ago 23» (Carlos, 2026-09-02).
 *
 * Salía «Sun Aug 23»: los diez primeros caracteres del `toString()` de un
 * Date — en inglés, con el día de la semana y sin el año, en un papel que se
 * firma en español. La fecha es un DÍA del calendario, así que se lee en UTC
 * (así se guarda) y el mes se nombra en el idioma de quien imprime.
 */
function fechaLote(value: Date | string, locale: Locale): string {
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  const mes = MESES[locale]?.[date.getUTCMonth()] ?? MESES.es[date.getUTCMonth()];
  return `${date.getUTCFullYear()} ${mes} ${String(date.getUTCDate()).padStart(2, "0")}`;
}

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
  const fechaEstado = effectiveDocumentDate(document);
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
      // Formateados por su unidad (Carlos, 2026-09-02): «200» y no «200.0000»
      // para piezas, tres decimales para lo que se pesa. La diferencia se
      // resta en Decimal: la coma flotante no entra a un papel que se firma.
      const teorico = row.theoretical ?? "0";
      const contado = row.counted ?? "0";
      const diferencia = new Prisma.Decimal(contado).minus(new Prisma.Decimal(teorico)).toString();
      return [
        String(row.lineNo),
        row.sku,
        row.name,
        row.theoretical === null ? "" : formatQuantity(row.theoretical, row.baseUnit),
        row.counted === null ? "" : formatQuantity(row.counted, row.baseUnit),
        formatQuantity(diferencia, row.baseUnit),
      ];
    }

    // "3 Caja ×12 = 36 piezas": lo que el usuario tecleó Y su equivalencia, para
    // que quien recibe pueda contar sin hacer la cuenta.
    //
    // ── El NOMBRE de la unidad, no su código (F4-TICKET-03) ─────────────
    //
    // Decía `36 unit`. Es el papel que alguien FIRMA al recibir mercancía: lo
    // lee un almacenista, no un programador, y `unit` es un identificador de
    // catálogo interno que esa persona nunca vio. En minúscula y plural porque
    // acompaña a un número — la misma convención que el resto de la app.
    //
    // Y la cantidad pasa por `formatQuantity`: los decimales los decide la
    // CATEGORÍA de la unidad. Sin eso, un producto que se cuenta de a uno salía
    // impreso como `36.0000`.
    const base = formatQuantityWithUnit(row.quantityBase ?? "", row.baseUnit, input.locale);
    // La equivalencia solo cuando aporta (Carlos, 2026-09-02, revisado): con
    // una presentación de factor 1, «50 = 50 piezas» es decir lo mismo dos
    // veces. Se compara en Decimal: «50» y «50.0000» son el mismo número.
    const conEquivalencia =
      row.presentationName !== null &&
      row.quantityInput !== null &&
      row.quantityBase !== null &&
      !new Prisma.Decimal(row.quantityInput).equals(new Prisma.Decimal(row.quantityBase));
    const cantidad = conEquivalencia ? `${row.quantityInput} = ${base}` : base;

    return [
      String(row.lineNo),
      row.sku,
      row.name,
      row.presentationName ?? "—",
      cantidad,
      ...(conLotes
        ? [
            [
              row.lotCode,
              row.expiresAt ? fechaLote(row.expiresAt, input.locale) : null,
              row.location,
            ]
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
              // La «Fecha» del papel es la del ESTADO: el asiento o la cancelación
              // (un borrador no tiene PDF). La captura se agrega aparte solo si
              // fue otro día del calendario del negocio: repetir la misma fecha
              // dos veces en el papel es ruido; un conteo abierto el 1 y asentado
              // el 3 es un dato de auditoría.
              ...dato(t("pdf.date"), fecha(fechaEstado, input.locale, input.tenant.timezone)),
              ...(localCalendarDate(input.tenant.timezone, document.createdAt) !==
              localCalendarDate(input.tenant.timezone, fechaEstado)
                ? dato(
                    t("pdf.openedAt"),
                    fecha(document.createdAt, input.locale, input.tenant.timezone),
                  )
                : []),
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
