import ExcelJS from "exceljs";
import { ExpensesExportService } from "./expenses-export.service";

/**
 * Carlos (2026-10-31): en el Excel de gastos los cuatro montos llevan NÚMEROS
 * —para sumarlos sin el triángulo verde de «número almacenado como texto»— y
 * el folio, las fechas, la referencia y la cuenta van con formato Texto.
 */
const USER = { userId: "u-1", tenantId: "t-1", permissions: [], locale: "es" as const };
const SCOPE = { warehouseIds: "all" as const };

async function primeraFila(body: Buffer): Promise<Map<string, ExcelJS.Cell>> {
  const workbook = new ExcelJS.Workbook();
  type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(body as unknown as XlsxInput);
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) {
    throw new Error("sin hoja");
  }
  const celdas = new Map<string, ExcelJS.Cell>();
  sheet.getRow(1).eachCell((encabezado, columna) => {
    celdas.set(String(encabezado.value), sheet.getRow(2).getCell(columna));
  });
  return celdas;
}

describe("ExpensesExportService — el Excel de gastos", () => {
  const gasto = {
    folio: "GTO-000001",
    expenseDate: "2026-10-31",
    categoryName: "Renta",
    supplierName: null,
    beneficiary: "Don Pepe",
    description: "Renta de octubre",
    reference: "0042",
    warehouseName: "Centro",
    amount: "1000.50",
    discount: "0",
    taxAmount: "160.08",
    total: "1160.58",
    status: "active",
    paymentStatus: "paid",
    paymentMethod: "cash",
    paidAt: "2026-10-31T12:00:00.000Z",
    accountRef: "001000000018",
    dueDate: null,
    notes: null,
  };
  const expenses = {
    count: jest.fn().mockResolvedValue(1),
    all: jest.fn().mockResolvedValue([gasto]),
  };
  // biome-ignore lint/suspicious/noExplicitAny: doble parcial a propósito
  const servicio = new ExpensesExportService(expenses as any);

  it("monto, descuento, impuesto y total son números; folio, fechas y cuenta, texto", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: el query parcial basta para el export
    const { body } = await servicio.build(USER, SCOPE, { format: "xlsx" } as any);
    const fila = await primeraFila(body);

    for (const [columna, valor] of [
      ["Monto", 1000.5],
      ["Descuento", 0],
      ["Impuesto", 160.08],
      ["Total", 1160.58],
    ] as const) {
      expect({ columna, type: fila.get(columna)?.type, value: fila.get(columna)?.value }).toEqual({
        columna,
        type: ExcelJS.ValueType.Number,
        value: valor,
      });
    }
    for (const [columna, valor] of [
      ["Folio", "GTO-000001"],
      ["Fecha", "2026-10-31"],
      ["Referencia", "0042"],
      ["Cuenta", "001000000018"],
      ["Pagado el", "2026-10-31"],
    ] as const) {
      expect({
        columna,
        value: fila.get(columna)?.value,
        numFmt: fila.get(columna)?.numFmt,
      }).toEqual({ columna, value: valor, numFmt: "@" });
    }
  });

  it("en inglés, los mismos montos son números", async () => {
    // biome-ignore lint/suspicious/noExplicitAny: el query parcial basta para el export
    const { body } = await servicio.build(USER, SCOPE, { format: "xlsx" } as any, "en");
    const fila = await primeraFila(body);

    expect(fila.get("Amount")?.value).toBe(1000.5);
    expect(fila.get("Tax")?.value).toBe(160.08);
    expect(fila.get("Total")?.value).toBe(1160.58);
    expect(fila.get("Folio")?.value).toBe("GTO-000001");
  });
});
