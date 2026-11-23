import ExcelJS from "exceljs";
import { ShiftsExportService } from "./shifts-export.service";
import type { ShiftRow } from "./shifts-report.service";

/**
 * F10-CASHMOV-06 — el Excel de «Cierres de turno» gana «Entradas de efectivo»
 * y «Retiros de efectivo» AL FINAL, como números. Las columnas de hoy no se
 * mueven: una hoja que alguien ya arma con fórmulas sobre la columna M sigue
 * funcionando.
 */
const USER = { userId: "u-1", tenantId: "t-1", permissions: [], locale: "es" as const };
const SCOPE = { warehouseIds: "all" as const };

const HOY_ES = [
  "Folio",
  "Apertura",
  "Cierre",
  "Sucursal",
  "Abrió",
  "Cerró",
  "Efectivo",
  "Tarjeta",
  "Transferencia",
  "Ventas",
  "Fondo inicial",
  "Gastos en efectivo",
  "Calculado",
  "Contado",
  "Diferencia",
  "Nota",
];
const HOY_EN = [
  "Folio",
  "Opened",
  "Closed",
  "Store",
  "Opened by",
  "Closed by",
  "Cash",
  "Card",
  "Transfer",
  "Sales",
  "Opening cash",
  "Cash expenses",
  "Expected",
  "Counted",
  "Difference",
  "Note",
];

const turno: ShiftRow = {
  id: "s-1",
  folio: "TUR-000007",
  status: "closed",
  warehouse: { id: "w-1", name: "Centro" },
  openedBy: { id: "u-1", name: "Ana" },
  openedAt: "2026-11-23T15:00:00.000Z",
  closedBy: { id: "u-1", name: "Ana" },
  closedAt: "2026-11-23T23:00:00.000Z",
  salesCount: 4,
  totals: [
    { method: "cash", total: "3000", count: 3 },
    { method: "card", total: "120", count: 1 },
    { method: "transfer", total: "0", count: 0 },
  ],
  openingCash: "500",
  cashExpenses: { total: "0", count: 0 },
  calculatedCash: "1900",
  declaredCash: "1900",
  cashDifference: "0",
  closingNote: "0042",
  cashIn: "400.5",
  cashOut: "2000",
};

function servicio() {
  const shifts = {
    count: jest.fn().mockResolvedValue(1),
    timeZone: jest.fn().mockResolvedValue("America/Mexico_City"),
    all: jest.fn().mockResolvedValue([turno]),
  };
  // biome-ignore lint/suspicious/noExplicitAny: doble parcial a propósito
  return new ShiftsExportService(shifts as any);
}

async function hoja(body: Buffer): Promise<ExcelJS.Worksheet> {
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

describe("ShiftsExportService — entradas y retiros al final (F10-CASHMOV-06)", () => {
  it("en español: las columnas de hoy en su orden, y las dos nuevas al final", async () => {
    const sheet = await hoja(
      (await servicio().build(USER, SCOPE, { format: "xlsx" } as never, "es")).body,
    );

    expect(valores(sheet.getRow(1))).toEqual([
      ...HOY_ES,
      "Entradas de efectivo",
      "Retiros de efectivo",
    ]);
  });

  it("en inglés también", async () => {
    const sheet = await hoja(
      (await servicio().build(USER, SCOPE, { format: "xlsx" } as never, "en")).body,
    );

    expect(valores(sheet.getRow(1))).toEqual([...HOY_EN, "Cash paid in", "Cash paid out"]);
  });

  it("los dos importes nuevos van como NÚMERO, después de la nota", async () => {
    const sheet = await hoja(
      (await servicio().build(USER, SCOPE, { format: "xlsx" } as never, "es")).body,
    );
    const datos = sheet.getRow(2);

    expect(datos.getCell(16).value).toBe("0042");
    for (const [columna, valor] of [
      [17, 400.5],
      [18, 2000],
    ] as const) {
      expect({
        columna,
        type: datos.getCell(columna).type,
        value: datos.getCell(columna).value,
      }).toEqual({ columna, type: ExcelJS.ValueType.Number, value: valor });
    }
  });

  it("en CSV, la fila de hoy queda igual y las dos nuevas se agregan al final", async () => {
    const csv = (
      await servicio().build(USER, SCOPE, { format: "csv" } as never, "es")
    ).body.toString("utf8");
    const [encabezado, fila] = csv.replace(/^﻿/, "").trim().split(/\r?\n/);

    expect(encabezado).toBe([...HOY_ES, "Entradas de efectivo", "Retiros de efectivo"].join(","));
    expect(fila).toMatch(/,Ana,Ana,3000,120,0,4,500,0,1900,1900,0,0042,400\.5,2000$/);
  });
});
