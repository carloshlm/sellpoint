import { unitName } from "@sellpoint/shared";
import type { PdfDocumentInput, PdfRow } from "./document-pdf.renderer";
import { spreadsheetRowsFor } from "./document-spreadsheet";

/**
 * Carlos (2026-10-30): además del PDF, el movimiento baja en Excel. Sale de las
 * MISMAS filas que el papel (`pdfRowsFor`), con las cantidades como número y
 * las columnas que el papel decide: lote solo si hay lotes, costo solo en una
 * factura de compra.
 */
describe("spreadsheetRowsFor", () => {
  const t = (key: string) => key;
  const fila = (cambios: Partial<PdfRow>): PdfRow => ({
    lineNo: 1,
    sku: "AGUA1L001",
    name: "Agua 1L",
    presentationName: "Pieza",
    quantityInput: "100",
    quantityBase: "100",
    baseUnit: "unit",
    unitCost: null,
    lotCode: null,
    expiresAt: null,
    location: null,
    theoretical: null,
    counted: null,
    ...cambios,
  });
  const documento = (
    type: PdfDocumentInput["document"]["type"],
    rows: PdfRow[],
    reasonCode: string | null = "adjustment",
  ): PdfDocumentInput => ({
    tenant: { name: "Farmacia", legalName: null, taxId: null, timezone: "America/Mexico_City" },
    document: {
      folio: "ENT-000057",
      type,
      status: "confirmed",
      warehouseName: "Almacén Central",
      linkedWarehouseName: null,
      reasonCode,
      reference: null,
      reasonNote: null,
      createdAt: new Date("2026-09-19T16:49:00Z"),
      confirmedAt: new Date("2026-09-19T16:50:00Z"),
      canceledAt: null,
      createdByName: "Carlos H.",
      authorizedByName: null,
    },
    rows,
    locale: "es",
    currency: "MXN",
  });

  it("un inventario físico: teórico, contado y diferencia, como números", () => {
    const { rows, numericColumns } = spreadsheetRowsFor(
      documento("physical_count", [
        fila({
          sku: "OAXACA001",
          name: "Queso Oaxaca",
          baseUnit: "kg",
          theoretical: "448.8000",
          counted: "450.5000",
          lotCode: "ST1",
          expiresAt: new Date("2033-07-01T00:00:00Z"),
          location: "00-00-00",
        }),
      ]),
      t,
    );

    expect(rows[0]).toEqual([
      "#",
      "pdf.sku",
      "pdf.product",
      "pdf.theoretical",
      "pdf.counted",
      "pdf.difference",
      "pdf.unit",
      "pdf.lot",
      "pdf.expiresAt",
      "pdf.location",
    ]);
    expect(rows[1]).toEqual([
      "1",
      "OAXACA001",
      "Queso Oaxaca",
      "448.8",
      "450.5",
      "1.7",
      unitName("kg", "es"),
      "ST1",
      "2033-07-01",
      "00-00-00",
    ]);
    expect(numericColumns).toEqual([0, 3, 4, 5]);
  });

  it("una entrada: lo que se tecleó en su presentación y su equivalencia en unidad base", () => {
    const { rows, numericColumns } = spreadsheetRowsFor(
      documento("entry", [
        fila({ presentationName: "Caja ×12", quantityInput: "3", quantityBase: "36.0000" }),
      ]),
      t,
    );

    expect(rows[0]).toEqual([
      "#",
      "pdf.sku",
      "pdf.product",
      "pdf.presentation",
      "pdf.quantity",
      "pdf.quantityBase",
      "pdf.unit",
    ]);
    expect(rows[1]).toEqual([
      "1",
      "AGUA1L001",
      "Agua 1L",
      "Caja ×12",
      "3",
      "36",
      unitName("unit", "es"),
    ]);
    expect(numericColumns).toEqual([0, 4, 5]);
  });

  it("sin lotes ni ubicación no hay columnas vacías que parezcan datos faltantes", () => {
    const { rows } = spreadsheetRowsFor(documento("exit", [fila({})]), t);

    expect(rows[0]).not.toContain("pdf.lot");
    expect(rows[0]).not.toContain("pdf.location");
  });

  it("el costo unitario va solo en una factura de compra, como en el papel", () => {
    const factura = spreadsheetRowsFor(
      documento("entry", [fila({ unitCost: "40.5000" })], "invoice"),
      t,
    );
    const ajuste = spreadsheetRowsFor(documento("entry", [fila({ unitCost: "40.5000" })]), t);

    expect(factura.rows[0]?.at(-1)).toBe("pdf.unitCost");
    expect(factura.rows[1]?.at(-1)).toBe("40.5");
    expect(factura.numericColumns).toContain(7);
    expect(ajuste.rows[0]).not.toContain("pdf.unitCost");
  });
});
