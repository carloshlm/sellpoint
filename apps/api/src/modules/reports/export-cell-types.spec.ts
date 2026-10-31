import ExcelJS from "exceljs";
import { CatalogExportService } from "./catalog-export.service";
import { KardexExportService } from "./kardex-export.service";
import { SalesExportService } from "./sales-export.service";
import { ShiftsExportService } from "./shifts-export.service";
import { StockExportService } from "./stock-export.service";
import { TaxExportService } from "./tax-export.service";

/**
 * Carlos (2026-10-31): en el Excel de cada reporte, las columnas de cantidades
 * y de dinero llevan NÚMEROS —para que Excel las sume, ordene y filtre sin el
 * triángulo verde de «número almacenado como texto»— y todo lo demás va con
 * formato Texto: folios, códigos, lotes y fechas se quedan exactamente como
 * salieron.
 */
const USER = { userId: "u-1", tenantId: "t-1", permissions: [], locale: "es" as const };
const SCOPE = { warehouseIds: "all" as const };
type Mock = jest.Mock;

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

/** La celda de la PRIMERA fila de datos bajo el encabezado `columna`. */
function celda(sheet: ExcelJS.Worksheet, columna: string): ExcelJS.Cell {
  const encabezado = (sheet.getRow(1).values as unknown[]).indexOf(columna);
  if (encabezado < 1) {
    throw new Error(`no hay columna «${columna}»`);
  }
  return sheet.getRow(2).getCell(encabezado);
}

function esNumero(sheet: ExcelJS.Worksheet, columna: string, valor: number) {
  const c = celda(sheet, columna);
  expect({ columna, type: c.type, value: c.value }).toEqual({
    columna,
    type: ExcelJS.ValueType.Number,
    value: valor,
  });
}

function esTexto(sheet: ExcelJS.Worksheet, columna: string, valor: string) {
  const c = celda(sheet, columna);
  expect({ columna, value: c.value, numFmt: c.numFmt }).toEqual({
    columna,
    value: valor,
    numFmt: "@",
  });
}

// biome-ignore lint/suspicious/noExplicitAny: dobles parciales a propósito
const doble = (valor: unknown) => valor as any;

describe("los reportes en Excel: números como número, lo demás como texto", () => {
  it("ventas: neto, impuesto y total son números; el folio y el código de barras, texto", async () => {
    const sales = {
      count: jest.fn().mockResolvedValue(1),
      list: jest.fn().mockResolvedValue({
        total: 1,
        rows: [
          {
            folio: "VTA-000001",
            barcode: "001000000018",
            createdAt: "2026-10-31T10:00:00.000Z",
            seller: { name: "Ana" },
            warehouse: { name: "Centro" },
            status: "completed",
            paymentMethod: "cash",
            total: "116.00",
            taxTotal: "16.00",
          },
        ],
      }),
    };
    const servicio = new SalesExportService(doble(sales));

    const { body } = await servicio.build(USER, SCOPE, doble({ format: "xlsx" }));
    const sheet = await hoja(body);

    esNumero(sheet, "Neto", 100);
    esNumero(sheet, "Impuesto", 16);
    esNumero(sheet, "Total", 116);
    esTexto(sheet, "Folio", "VTA-000001");
    esTexto(sheet, "Código de barras", "001000000018");
    esTexto(sheet, "Fecha", "2026-10-31");
  });

  it("impuestos: tasa, base, impuesto cobrado y tickets son números, en los dos idiomas", async () => {
    const taxes = {
      report: jest.fn().mockResolvedValue({
        rows: [{ name: "IVA 16 %", rate: "16", base: "1000.5", amount: "160.08", tickets: 3 }],
      }),
    };
    const servicio = new TaxExportService(doble(taxes));

    const es = await hoja((await servicio.build(USER, SCOPE, doble({ format: "xlsx" }))).body);
    esNumero(es, "Tasa %", 16);
    esNumero(es, "Base", 1000.5);
    esNumero(es, "Impuesto cobrado", 160.08);
    esNumero(es, "Tickets", 3);
    esTexto(es, "Impuesto", "IVA 16 %");

    const en = await hoja(
      (await servicio.build(USER, SCOPE, doble({ format: "xlsx" }), "en")).body,
    );
    esNumero(en, "Rate %", 16);
    esNumero(en, "Tax collected", 160.08);
    esTexto(en, "Tax", "IVA 16 %");
  });

  it("cierres de turno: los montos y las ventas son números; fechas y nota, texto", async () => {
    const shifts = {
      count: jest.fn().mockResolvedValue(1),
      timeZone: jest.fn().mockResolvedValue("America/Mexico_City"),
      all: jest.fn().mockResolvedValue([
        {
          openedAt: "2026-10-31T15:00:00.000Z",
          closedAt: "2026-10-31T23:00:00.000Z",
          warehouse: { name: "Centro" },
          openedBy: { name: "Ana" },
          closedBy: { name: "Luis" },
          totals: [
            { method: "cash", total: "500.50" },
            { method: "card", total: "120" },
          ],
          salesCount: 7,
          openingCash: "200",
          cashExpenses: { total: "50" },
          calculatedCash: "650.50",
          declaredCash: "650",
          cashDifference: "-0.50",
          closingNote: "0042",
        },
      ]),
    };
    const servicio = new ShiftsExportService(doble(shifts));

    const sheet = await hoja((await servicio.build(USER, SCOPE, doble({ format: "xlsx" }))).body);

    esNumero(sheet, "Efectivo", 500.5);
    esNumero(sheet, "Tarjeta", 120);
    esNumero(sheet, "Transferencia", 0);
    esNumero(sheet, "Ventas", 7);
    esNumero(sheet, "Fondo inicial", 200);
    esNumero(sheet, "Gastos en efectivo", 50);
    esNumero(sheet, "Calculado", 650.5);
    esNumero(sheet, "Contado", 650);
    esNumero(sheet, "Diferencia", -0.5);
    esTexto(sheet, "Apertura", "2026-10-31 09:00");
    esTexto(sheet, "Nota", "0042");
  });

  it("kardex: cantidad, saldo y costo unitario son números; folio, lote y fecha, texto", async () => {
    const kardex = {
      list: jest.fn().mockResolvedValue({
        total: 1,
        rows: [
          {
            createdAt: new Date("2026-10-31T10:30:00.000Z"),
            document: { folio: "ENT-000007", type: "entry" },
            direction: "exit",
            reasonCode: "sale",
            lot: { lotCode: "0042" },
            location: "A-01",
            warehouse: { name: "Centro" },
            quantity: "2.5000",
            balanceAfter: "7.5000",
            unitCost: "8.5",
            createdBy: { name: "Ana" },
          },
        ],
      }),
    };
    const prisma = {
      withTenantContext: jest.fn((_t: string, fn: (tx: unknown) => unknown) =>
        fn({ product: { findUniqueOrThrow: jest.fn().mockResolvedValue({ baseUnit: "kg" }) } }),
      ),
    };
    const servicio = new KardexExportService(doble(kardex), doble(prisma));
    const t = (key: string) => key.replace("inventory.kardexExport.", "");

    const { body } = await servicio.build(USER, SCOPE, "p-1", doble({}), "xlsx", "es", t);
    const sheet = await hoja(body);

    esNumero(sheet, "quantity", -2.5);
    esNumero(sheet, "balance", 7.5);
    esNumero(sheet, "unitCost", 8.5);
    esTexto(sheet, "folio", "ENT-000007");
    esTexto(sheet, "lot", "0042");
    esTexto(sheet, "date", "2026-10-31 10:30");
  });

  describe("stock", () => {
    const stock = {
      count: jest.fn().mockResolvedValue(1),
      list: jest.fn().mockResolvedValue({
        total: 1,
        rows: [
          {
            name: "Paracetamol",
            sku: "001000000018",
            warehouseName: "Centro",
            quantity: "12.5",
            baseUnit: "unit",
            stockMin: "3",
            belowMin: false,
            avgCost: "8.50",
            totalValue: "106.25",
          },
        ],
      }),
      listLots: jest.fn().mockResolvedValue({
        total: 1,
        rows: [
          {
            name: "Paracetamol",
            sku: "001000000018",
            warehouseName: "Centro",
            unlotted: false,
            lotCode: "0042",
            expiresAt: "2027-01-31",
            location: "A-01",
            quantity: "4",
            baseUnit: "unit",
          },
        ],
      }),
    };

    it("cantidad, mínimo, costo promedio y valor son números; el sku, texto", async () => {
      const servicio = new StockExportService(doble(stock));

      const sheet = await hoja((await servicio.build(USER, SCOPE, doble({ format: "xlsx" }))).body);

      esNumero(sheet, "Cantidad", 12.5);
      esNumero(sheet, "Mínimo", 3);
      esNumero(sheet, "Costo promedio", 8.5);
      esNumero(sheet, "Valor", 106.25);
      esTexto(sheet, "SKU", "001000000018");
      esTexto(sheet, "Unidad", "unit");
    });

    it("por lote: la cantidad es número; el lote y la caducidad, texto", async () => {
      const servicio = new StockExportService(doble(stock));

      const { body } = await servicio.build(USER, SCOPE, doble({ format: "xlsx", detail: "lots" }));
      const sheet = await hoja(body);

      esNumero(sheet, "Cantidad", 4);
      esTexto(sheet, "Lote", "0042");
      esTexto(sheet, "Caducidad", "2027-01-31");
      esTexto(sheet, "SKU", "001000000018");
    });
  });

  describe("catálogo", () => {
    let prisma: { withTenantContext: Mock };
    let imports: { catalogRows: Mock };

    beforeEach(() => {
      prisma = {
        withTenantContext: jest.fn((_t: string, fn: (tx: unknown) => unknown) =>
          fn({
            user: { count: jest.fn().mockResolvedValue(1) },
            warehouse: {
              count: jest.fn().mockResolvedValue(1),
              findMany: jest.fn().mockResolvedValue([
                {
                  name: "Centro",
                  address: "Av. 1",
                  addressLine2: null,
                  city: null,
                  region: null,
                  postalCode: "07300",
                  isActive: true,
                  _count: { stock: 14 },
                },
              ]),
            },
            tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ country: "MX" }) },
          }),
        ),
      };
      imports = {
        catalogRows: jest.fn().mockResolvedValue({
          header: ["sku", "costo", "Sustancia activa"],
          rows: [["001000000018", "8.5", "0042"]],
          custom: ["sustancia"],
          numericColumns: [1],
        }),
      };
    });

    it("sucursales: «Productos con stock» es número; el nombre, texto", async () => {
      const servicio = new CatalogExportService(doble(prisma), doble(imports));

      const sheet = await hoja((await servicio.warehouses(USER, SCOPE, "xlsx")).body);

      esNumero(sheet, "Productos con stock", 14);
      esTexto(sheet, "Nombre", "Centro");
    });

    it("productos: usa las columnas numéricas de la plantilla, y lo demás va como texto", async () => {
      const servicio = new CatalogExportService(doble(prisma), doble(imports));

      const sheet = await hoja((await servicio.products(USER, "xlsx")).body);

      esNumero(sheet, "costo", 8.5);
      esTexto(sheet, "sku", "001000000018");
      esTexto(sheet, "Sustancia activa", "0042");
    });
  });
});
