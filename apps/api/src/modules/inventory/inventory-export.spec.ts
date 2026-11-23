import ExcelJS from "exceljs";
import { InventoryExportService } from "./inventory-export.service";
import type { KardexService } from "./kardex.service";
import type { LotsService } from "./lots.service";

/**
 * Carlos (2026-10-31): en el Excel de vencimientos y en el de tránsito, la
 * cantidad y los días restantes llevan NÚMEROS; el sku, el lote, el folio y
 * las fechas van con formato Texto.
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

describe("InventoryExportService — vencimientos y tránsito en Excel", () => {
  const lots = {
    listExpiring: jest.fn().mockResolvedValue([
      {
        name: "Paracetamol",
        sku: "001000000018",
        lot: { lotCode: "0042", expiresAt: new Date("2026-11-15T00:00:00.000Z") },
        daysLeft: -3,
        warehouse: { name: "Centro" },
        location: "A-01",
        quantity: "12.5",
      },
    ]),
  };
  const kardex = {
    inTransitDetail: jest.fn().mockResolvedValue([
      {
        name: "Paracetamol",
        sku: "001000000018",
        lotCode: "0042",
        origin: "Centro",
        destination: "Norte",
        quantity: "4",
        folio: "TRA-000003",
        sentAt: new Date("2026-10-30T18:00:00.000Z"),
      },
    ]),
  };
  // biome-ignore lint/suspicious/noExplicitAny: dobles parciales a propósito
  const servicio = new InventoryExportService(lots as any, kardex as any);

  it("vencimientos: días restantes y cantidad son números; sku, lote y caducidad, texto", async () => {
    const { body } = await servicio.expiring(USER, SCOPE, { days: 30 }, "xlsx");
    const fila = await primeraFila(body);

    expect(fila.get("Días restantes")?.value).toBe(-3);
    expect(fila.get("Cantidad")?.value).toBe(12.5);
    expect(fila.get("Cantidad")?.type).toBe(ExcelJS.ValueType.Number);
    for (const [columna, valor] of [
      ["SKU", "001000000018"],
      ["Lote", "0042"],
      ["Caduca", "2026-11-15"],
    ] as const) {
      expect({
        columna,
        value: fila.get(columna)?.value,
        numFmt: fila.get(columna)?.numFmt,
      }).toEqual({ columna, value: valor, numFmt: "@" });
    }
  });

  /**
   * F10-KPI-09 — «Costo promedio» y «Valor» son dinero: se deciden con el
   * PERMISO del usuario y no con lo que traiga la fila. Aunque la consulta
   * mandara los campos por error, el archivo de quien no tiene
   * `reports:read` no los lleva.
   */
  describe("el costo y el valor (F10-KPI-09)", () => {
    /** El exportador con una sola fila de vencimientos, con o sin costo. */
    const exportador = (unitCost: string | null, value: string | null) =>
      new InventoryExportService(
        {
          listExpiring: jest.fn().mockResolvedValue([
            {
              name: "Paracetamol",
              sku: "001000000018",
              lot: { lotCode: "0042", expiresAt: new Date("2026-11-15T00:00:00.000Z") },
              daysLeft: 4,
              warehouse: { name: "Centro" },
              location: "A-01",
              quantity: "12.5",
              unitCost,
              value,
            },
          ]),
        } as unknown as LotsService,
        kardex as unknown as KardexService,
      );
    const DUENO = { ...USER, permissions: ["inventory:read", "reports:read"] };

    it("con `reports:read`, el costo y el valor son números", async () => {
      const { body } = await exportador("8.50", "106.25").expiring(
        DUENO,
        SCOPE,
        { days: 30 },
        "xlsx",
      );
      const fila = await primeraFila(body);

      expect(fila.get("Costo promedio")?.value).toBe(8.5);
      expect(fila.get("Costo promedio")?.type).toBe(ExcelJS.ValueType.Number);
      expect(fila.get("Valor")?.value).toBe(106.25);
      expect(fila.get("Valor")?.type).toBe(ExcelJS.ValueType.Number);
    });

    it("sin costo, las dos celdas quedan vacías: un 0 se sumaría", async () => {
      const { body } = await exportador(null, null).expiring(DUENO, SCOPE, { days: 30 }, "xlsx");
      const fila = await primeraFila(body);

      expect([fila.get("Costo promedio")?.value, fila.get("Valor")?.value]).toEqual(["", ""]);
    });

    it("sin `reports:read` no salen, aunque la fila traiga los campos", async () => {
      const { body } = await exportador("8.50", "106.25").expiring(
        USER,
        SCOPE,
        { days: 30 },
        "xlsx",
      );
      const fila = await primeraFila(body);

      expect([...fila.keys()]).not.toContain("Costo promedio");
      expect([...fila.keys()]).not.toContain("Valor");
    });
  });

  it("en tránsito: la cantidad es número; sku, lote, folio y fecha, texto", async () => {
    const { body } = await servicio.inTransit(USER, SCOPE, {}, "xlsx");
    const fila = await primeraFila(body);

    expect(fila.get("Cantidad")?.value).toBe(4);
    expect(fila.get("Cantidad")?.type).toBe(ExcelJS.ValueType.Number);
    for (const [columna, valor] of [
      ["SKU", "001000000018"],
      ["Lote", "0042"],
      ["Folio", "TRA-000003"],
      ["Salió", "2026-10-30"],
    ] as const) {
      expect({
        columna,
        value: fila.get(columna)?.value,
        numFmt: fila.get(columna)?.numFmt,
      }).toEqual({ columna, value: valor, numFmt: "@" });
    }
  });
});
