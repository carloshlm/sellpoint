import ExcelJS from "exceljs";
import { parseSpreadsheet, serializeSpreadsheet } from "./spreadsheet";

/**
 * F5-CORE-01 — el serializador deja de estar casado con «Productos».
 *
 * Nació dentro de la importación de catálogo (F2-IMPORT) y por eso el nombre de
 * la hoja y el del archivo estaban clavados. Los reportes de F5 bajan ventas,
 * stock y kardex por el MISMO camino, y un Excel de ventas cuya hoja se llama
 * «Productos» miente sobre lo que contiene.
 *
 * Los defaults se conservan: los llamadores de F2 no cambian ni una línea, y
 * eso lo fija el test de abajo, no la buena intención.
 */
describe("serializeSpreadsheet", () => {
  async function hojaDe(body: Buffer): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);
    return workbook.worksheets[0]?.name ?? "";
  }

  const FILAS = [
    ["folio", "total"],
    ["VTA-000001", "20.00"],
  ];

  describe("sin opciones: exactamente lo de F2", () => {
    it("el xlsx baja como productos.xlsx con la hoja «Productos»", async () => {
      const { filename, body } = await serializeSpreadsheet(FILAS, "xlsx");

      expect(filename).toBe("productos.xlsx");
      expect(await hojaDe(body)).toBe("Productos");
    });

    it("el csv baja como productos.csv", async () => {
      const { filename, contentType } = await serializeSpreadsheet(FILAS, "csv");

      expect(filename).toBe("productos.csv");
      expect(contentType).toBe("text/csv; charset=utf-8");
    });
  });

  describe("con opciones: cada reporte se nombra a sí mismo", () => {
    it("la hoja y el archivo del xlsx toman lo que pide el llamador", async () => {
      const { filename, body } = await serializeSpreadsheet(FILAS, "xlsx", {
        sheetName: "Ventas",
        filenameBase: "ventas",
      });

      expect(filename).toBe("ventas.xlsx");
      expect(await hojaDe(body)).toBe("Ventas");
    });

    it("el csv también respeta el nombre del archivo", async () => {
      const { filename } = await serializeSpreadsheet(FILAS, "csv", { filenameBase: "ventas" });

      expect(filename).toBe("ventas.csv");
    });

    /**
     * Media opción es un caso real: el CSV no tiene hojas, así que un
     * llamador puede pasar solo `filenameBase`. Cada opción cae a SU default,
     * no al del conjunto.
     */
    it("pasar solo el nombre de hoja deja el filename por defecto", async () => {
      const { filename, body } = await serializeSpreadsheet(FILAS, "xlsx", {
        sheetName: "Stock",
      });

      expect(filename).toBe("productos.xlsx");
      expect(await hojaDe(body)).toBe("Stock");
    });
  });

  /**
   * El contenido no depende del bautizo: el mismo dataset con otro nombre de
   * hoja tiene que traer las mismas celdas.
   */
  it("el contenido no cambia por renombrar la hoja", async () => {
    const workbook = new ExcelJS.Workbook();
    const { body } = await serializeSpreadsheet(FILAS, "xlsx", { sheetName: "Kardex" });
    type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
    await workbook.xlsx.load(body as unknown as XlsxInput);

    const sheet = workbook.worksheets[0];
    expect(sheet?.getRow(1).getCell(1).value).toBe("folio");
    expect(sheet?.getRow(2).getCell(1).value).toBe("VTA-000001");
  });
});

/**
 * Carlos (2026-09-01): un conteo subido desde Excel llegó con TODA la columna
 * «contado» vacía. Una de las formas de llenarla es `=G2` arrastrado hacia
 * abajo, y ExcelJS descarta el valor en caché de una fórmula cuando es
 * «falsy» (`if (model.value)` en cell-xform): un 0 contado se leía como celda
 * vacía, o sea «no contado». Cuando la fórmula es una referencia simple a la
 * misma fila, el valor se resuelve leyendo esa celda.
 */
describe("parseSpreadsheet — fórmulas sin resultado en caché", () => {
  async function xlsx(build: (sheet: ExcelJS.Worksheet) => void): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    build(workbook.addWorksheet("Hoja"));
    return Buffer.from(await workbook.xlsx.writeBuffer()).toString("base64");
  }

  it("`=A2` sin caché toma el valor de A2, incluido el cero", async () => {
    const content = await xlsx((sheet) => {
      // Con «sku» para que la fila del teórico vacío no se descarte por vacía.
      sheet.addRow(["teorico", "contado", "sku"]);
      sheet.addRow([0, { formula: "A2" }, "S1"]);
      sheet.addRow([37, { formula: "A3" }, "S2"]);
      sheet.addRow(["", { formula: "A4" }, "S3"]);
    });

    const rows = await parseSpreadsheet(content, "xlsx");

    expect(rows.map((r) => r[1])).toEqual(["contado", "0", "37", ""]);
  });

  it("una fórmula compartida arrastrada resuelve la referencia de SU fila", async () => {
    const content = await xlsx((sheet) => {
      sheet.addRow(["teorico", "contado"]);
      sheet.addRow([5, { formula: "A2", shareType: "shared", ref: "B2:B4" }]);
      sheet.addRow([0, { sharedFormula: "B2" }]);
      sheet.addRow([12, { sharedFormula: "B2" }]);
    });

    const rows = await parseSpreadsheet(content, "xlsx");

    expect(rows.map((r) => r[1])).toEqual(["contado", "5", "0", "12"]);
  });

  it("con resultado en caché, el resultado manda sobre la referencia", async () => {
    const content = await xlsx((sheet) => {
      sheet.addRow(["teorico", "contado"]);
      sheet.addRow([5, { formula: "A2", result: 9 }]);
    });

    const rows = await parseSpreadsheet(content, "xlsx");

    expect(rows[1]?.[1]).toBe("9");
  });

  it("una referencia a OTRA fila no se resuelve: eso ya no es «la misma columna en cada fila»", async () => {
    const content = await xlsx((sheet) => {
      sheet.addRow(["teorico", "contado", "sku"]);
      sheet.addRow([5, { formula: "A1" }, "S1"]);
    });

    const rows = await parseSpreadsheet(content, "xlsx");

    expect(rows[1]?.[1]).toBe("");
  });

  it("una fórmula que no es referencia simple y no trae caché queda vacía", async () => {
    const content = await xlsx((sheet) => {
      sheet.addRow(["teorico", "contado"]);
      sheet.addRow([5, { formula: "SUM(A2:A3)" }]);
    });

    const rows = await parseSpreadsheet(content, "xlsx");

    expect(rows[1]?.[1]).toBe("");
  });
});
