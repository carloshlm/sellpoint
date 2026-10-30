import { Injectable } from "@nestjs/common";
import { unitName } from "@sellpoint/shared";
import { serializeSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../auth/types/auth-user";
import type { PdfDocumentInput } from "./document-pdf.renderer";
import { DocumentPdfService } from "./document-pdf.service";

type Translate = (key: string) => string;

/** «448.8000» → «448.8»: el Decimal sin los ceros de la columna `DECIMAL(14,4)`. */
const numero = (valor: string | null): string =>
  valor === null ? "" : new Prisma.Decimal(valor).toString();

/** La fecha tal cual, AAAA-MM-DD: así Excel la ordena sin interpretarla. */
const fecha = (valor: Date | string | null): string =>
  valor === null ? "" : (valor instanceof Date ? valor.toISOString() : valor).slice(0, 10);

/**
 * Carlos (2026-10-30) — las filas del Excel de un movimiento.
 *
 * Salen de las MISMAS filas que el papel (`pdfRowsFor`): lo que realmente pasó
 * en una entrada o salida, y lo que se contó en un inventario físico. Lo que
 * cambia es para quién: el papel se firma, el Excel se suma. Por eso las
 * cantidades van sin unidad pegada —la unidad tiene su columna— y se marcan
 * como número, y la diferencia del conteo se resta en Decimal, como allá.
 *
 * Las columnas las decide el papel: lote y caducidad solo si alguna fila trae
 * lote, ubicación solo si alguna la trae, y el costo unitario solo en una
 * factura de compra. Una columna vacía de punta a punta se lee como un dato
 * que falta.
 */
export function spreadsheetRowsFor(
  input: PdfDocumentInput,
  t: Translate,
): { rows: string[][]; numericColumns: number[] } {
  const { document, rows } = input;
  const esConteo = document.type === "physical_count";
  const conLotes = rows.some((r) => r.lotCode !== null);
  const conUbicacion = rows.some((r) => r.location !== null);
  const conCosto = !esConteo && document.reasonCode === "invoice";

  const principio = esConteo
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
        t("pdf.quantityBase"),
      ];
  const encabezado = [
    ...principio,
    t("pdf.unit"),
    ...(conLotes ? [t("pdf.lot"), t("pdf.expiresAt")] : []),
    ...(conUbicacion ? [t("pdf.location")] : []),
    ...(conCosto ? [t("pdf.unitCost")] : []),
  ];

  const cuerpo = rows.map((row) => {
    const cantidades = esConteo
      ? [
          numero(row.theoretical),
          numero(row.counted),
          new Prisma.Decimal(row.counted ?? "0")
            .minus(new Prisma.Decimal(row.theoretical ?? "0"))
            .toString(),
        ]
      : [row.presentationName ?? "", numero(row.quantityInput), numero(row.quantityBase)];
    return [
      String(row.lineNo),
      row.sku,
      row.name,
      ...cantidades,
      unitName(row.baseUnit, input.locale),
      ...(conLotes ? [row.lotCode ?? "", fecha(row.expiresAt)] : []),
      ...(conUbicacion ? [row.location ?? ""] : []),
      ...(conCosto ? [numero(row.unitCost)] : []),
    ];
  });

  const numericColumns = esConteo ? [0, 3, 4, 5] : [0, 4, 5];
  if (conCosto) {
    numericColumns.push(encabezado.length - 1);
  }
  return { rows: [encabezado, ...cuerpo], numericColumns };
}

@Injectable()
export class DocumentSpreadsheetService {
  constructor(private readonly pdf: DocumentPdfService) {}

  /** El Excel de un movimiento, con el folio por nombre: INV-000019.xlsx. */
  async render(
    user: AuthUser,
    documentId: string,
    t: Translate,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const { input, folio } = await this.pdf.load(user, documentId, "inventory.spreadsheet_draft");
    const { rows, numericColumns } = spreadsheetRowsFor(input, t);
    return serializeSpreadsheet(rows, "xlsx", {
      sheetName: folio,
      filenameBase: folio,
      numericColumns,
    });
  }
}
