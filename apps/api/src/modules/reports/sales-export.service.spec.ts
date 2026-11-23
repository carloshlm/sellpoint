import ExcelJS from "exceljs";
import { SalesExportService } from "./sales-export.service";
import type { SalesReportRow } from "./sales-report.service";

/**
 * F10-KPI-11 — el Excel de Ventas agrega AL FINAL el descuento y los motivos.
 * Ese archivo ya lo usa gente: quien armó una tabla dinámica o una fórmula
 * sobre la columna H no puede encontrarse otra cosa ahí. Las diez columnas de
 * hoy se quedan donde estaban; las cinco nuevas van después de «Total».
 */
const USER = { userId: "u-1", tenantId: "t-1", permissions: [], locale: "es" as const };
const SCOPE = { warehouseIds: "all" as const };

const HOY = [
  "Folio",
  "Código de barras",
  "Fecha",
  "Vendió",
  "Sucursal",
  "Estado",
  "Pago",
  "Neto",
  "Impuesto",
  "Total",
];

const venta = (overrides: Partial<SalesReportRow> = {}): SalesReportRow => ({
  id: "s-1",
  folio: "VTA-000001",
  barcode: "001000000018",
  createdAt: "2026-11-20T16:00:00.000Z",
  status: "completed",
  paymentMethod: "cash",
  total: "116.00",
  taxTotal: "16.00",
  warehouseId: "w-1",
  warehouse: { id: "w-1", name: "Centro" },
  seller: { id: "u-1", name: "Ana Pérez" },
  discount: "20.00",
  discountReason: "Cliente frecuente",
  cancelReason: null,
  canceledAt: null,
  canceledBy: null,
  ...overrides,
});

async function hoja(rows: SalesReportRow[]): Promise<ExcelJS.Worksheet> {
  const sales = {
    count: jest.fn().mockResolvedValue(rows.length),
    list: jest.fn().mockResolvedValue({ total: rows.length, rows }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: doble parcial a propósito
  const servicio = new SalesExportService(sales as any);
  const { body } = await servicio.build(USER, SCOPE, { format: "xlsx" });
  const workbook = new ExcelJS.Workbook();
  type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(body as unknown as XlsxInput);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) {
    throw new Error("sin hoja");
  }
  return sheet;
}

const valores = (fila: ExcelJS.Row) => (fila.values as unknown[]).slice(1);
/** Una celda sin dato: ExcelJS la devuelve en `null` o en "", según cómo se escribió. */
const vacia = (celda: ExcelJS.Cell) => celda.value === null || celda.value === "";

describe("el Excel de Ventas con el descuento y los motivos (F10-KPI-11)", () => {
  it("las columnas de hoy no se mueven y las cinco nuevas van al final", async () => {
    const sheet = await hoja([venta()]);

    expect(valores(sheet.getRow(1))).toEqual([
      ...HOY,
      "Descuento",
      "Motivo del descuento",
      "Canceló",
      "Fecha de cancelación",
      "Motivo de la cancelación",
    ]);
  });

  it("las diez celdas de siempre dicen lo mismo que antes", async () => {
    const sheet = await hoja([venta()]);

    expect(valores(sheet.getRow(2)).slice(0, HOY.length)).toEqual([
      "VTA-000001",
      "001000000018",
      "2026-11-20",
      "Ana Pérez",
      "Centro",
      "Cobrada",
      "Efectivo",
      100,
      16,
      116,
    ]);
  });

  it("una cobrada con descuento: el descuento es número y el motivo, texto", async () => {
    const sheet = await hoja([venta()]);
    const fila = sheet.getRow(2);

    expect(fila.getCell(11).value).toBe(20);
    expect(fila.getCell(11).type).toBe(ExcelJS.ValueType.Number);
    expect(fila.getCell(12).value).toBe("Cliente frecuente");
    // Sin cancelación, las tres celdas quedan vacías: la celda vacía ya dice
    // «no hay dato».
    for (const columna of [13, 14, 15]) {
      expect(vacia(fila.getCell(columna))).toBe(true);
    }
  });

  it("una cancelada dice quién, cuándo y por qué", async () => {
    const sheet = await hoja([
      venta({
        status: "canceled",
        discount: "0.00",
        discountReason: null,
        cancelReason: "Se equivocó de producto",
        canceledAt: "2026-11-21T18:30:00.000Z",
        canceledBy: { id: "u-2", name: "Luis Cajero" },
      }),
    ]);
    const fila = sheet.getRow(2);

    expect(fila.getCell(6).value).toBe("Anulada");
    expect(fila.getCell(11).value).toBe(0);
    expect(vacia(fila.getCell(12))).toBe(true);
    expect(fila.getCell(13).value).toBe("Luis Cajero");
    expect(fila.getCell(14).value).toBe("2026-11-21");
    expect(fila.getCell(15).value).toBe("Se equivocó de producto");
  });
});
