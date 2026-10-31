import ExcelJS from "exceljs";
import { columnIndexes, parseSpreadsheet, serializeSpreadsheet } from "./spreadsheet";

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

  /**
   * Carlos (2026-10-30): el Excel de un movimiento lleva las cantidades como
   * NÚMERO, para poder sumarlas. Solo en las columnas que se piden: un código
   * como «0042» tiene que seguir siendo texto, con su cero.
   */
  describe("numericColumns", () => {
    async function hoja(body: Buffer) {
      const workbook = new ExcelJS.Workbook();
      type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
      await workbook.xlsx.load(body as unknown as XlsxInput);
      const sheet = workbook.worksheets[0];
      if (sheet === undefined) {
        throw new Error("sin hoja");
      }
      return sheet;
    }
    const CON_CANTIDADES = [
      ["sku", "cantidad"],
      ["0042", "1.5"],
      ["0043", ""],
    ];

    it("las columnas pedidas se escriben como número; vacío sigue vacío", async () => {
      const { body } = await serializeSpreadsheet(CON_CANTIDADES, "xlsx", { numericColumns: [1] });
      const sheet = await hoja(body);

      expect(sheet.getCell("B2").value).toBe(1.5);
      expect(sheet.getCell("A2").value).toBe("0042");
      expect(sheet.getCell("B3").value).not.toBe(0);
      expect(sheet.getCell("B1").value).toBe("cantidad");
    });

    it("sin la opción, todo sigue como texto, igual que antes", async () => {
      const { body } = await serializeSpreadsheet(CON_CANTIDADES, "xlsx");
      const sheet = await hoja(body);

      expect(sheet.getCell("B2").value).toBe("1.5");
    });
  });

  /**
   * Carlos (2026-10-31): las columnas de texto del Excel tienen que SER texto
   * —con el formato «Texto» de Excel, no «General»— para que un código como
   * «001000000018» no pierda sus ceros ni se vuelva notación científica
   * cuando alguien lo vuelve a teclear. Las numéricas siguen en «General» y
   * llevan números de verdad, que Excel suma, ordena y filtra.
   */
  describe("formato Texto en las columnas que no son numéricas", () => {
    async function hoja(body: Buffer) {
      const workbook = new ExcelJS.Workbook();
      type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
      await workbook.xlsx.load(body as unknown as XlsxInput);
      const sheet = workbook.worksheets[0];
      if (sheet === undefined) {
        throw new Error("sin hoja");
      }
      return sheet;
    }
    const FILAS_MIXTAS = [
      ["sku", "nombre", "costo"],
      ["001000000018", "Paracetamol", "22.5"],
      ["0042", "Ibuprofeno", ""],
    ];

    it("un código con ceros a la izquierda sigue siendo el MISMO texto, con formato Texto", async () => {
      const { body } = await serializeSpreadsheet(FILAS_MIXTAS, "xlsx", { numericColumns: [2] });
      const sheet = await hoja(body);

      expect(sheet.getCell("A2").type).toBe(ExcelJS.ValueType.String);
      expect(sheet.getCell("A2").value).toBe("001000000018");
      expect(sheet.getCell("A2").numFmt).toBe("@");
      expect(sheet.getCell("B2").numFmt).toBe("@");
      expect(sheet.getCell("A3").value).toBe("0042");
      expect(sheet.getCell("A3").numFmt).toBe("@");
    });

    it("la columna numérica lleva el número de verdad, en formato General", async () => {
      const { body } = await serializeSpreadsheet(FILAS_MIXTAS, "xlsx", { numericColumns: [2] });
      const sheet = await hoja(body);

      expect(sheet.getCell("C2").type).toBe(ExcelJS.ValueType.Number);
      expect(sheet.getCell("C2").value).toBe(22.5);
      expect(sheet.getCell("C2").numFmt).not.toBe("@");
    });

    /**
     * Carlos (2026-09-02): el kardex muestra «2.50» para una unidad continua.
     * El número se guarda limpio (2.5, para sumar) y se MUESTRA con los
     * decimales que traía el texto; un entero se queda en General.
     */
    it("el número se muestra con los decimales que traía: «2.50» y «116.00», no 2.5 y 116", async () => {
      const { body } = await serializeSpreadsheet(
        [["cantidad"], ["2.50"], ["116.00"], ["1.2345"], ["3"]],
        "xlsx",
        { numericColumns: [0] },
      );
      const sheet = await hoja(body);

      expect(sheet.getCell("A2").value).toBe(2.5);
      expect(sheet.getCell("A2").numFmt).toBe("0.00");
      expect(sheet.getCell("A3").value).toBe(116);
      expect(sheet.getCell("A3").numFmt).toBe("0.00");
      expect(sheet.getCell("A4").numFmt).toBe("0.0000");
      expect(sheet.getCell("A5").value).toBe(3);
      expect(sheet.getCell("A5").numFmt).toBeUndefined();
    });

    /**
     * La caducidad de una plantilla que se importa: si alguien teclea
     * «15/08/2026», Excel tiene que seguir volviéndola fecha (la importación
     * la lee como ISO). Con formato Texto quedaría literal y no se importaría.
     */
    it("una columna «sin formato» no lleva Texto ni número: lo tecleado lo decide Excel", async () => {
      const { body } = await serializeSpreadsheet(
        [
          ["sku", "caducidad", "contado"],
          ["0042", "2026-07-01", ""],
        ],
        "xlsx",
        { numericColumns: [2], plainColumns: [1] },
      );
      const sheet = await hoja(body);

      expect(sheet.getCell("B2").value).toBe("2026-07-01");
      expect(sheet.getCell("B2").numFmt).toBeUndefined();
      expect(sheet.getColumn(2).style?.numFmt).toBeUndefined();
      expect(sheet.getCell("A2").numFmt).toBe("@");
    });

    it("una celda vacía de una columna numérica sigue vacía: no se vuelve cero", async () => {
      const { body } = await serializeSpreadsheet(FILAS_MIXTAS, "xlsx", { numericColumns: [2] });
      const sheet = await hoja(body);

      expect(sheet.getCell("C3").type).not.toBe(ExcelJS.ValueType.Number);
      expect(sheet.getCell("C3").value ?? "").toBe("");
    });

    it("lo que no es un número limpio en una columna numérica se queda como estaba", async () => {
      const { body } = await serializeSpreadsheet(
        [
          ["sku", "cantidad"],
          ["A", "12 pzas"],
          ["B", "—"],
        ],
        "xlsx",
        { numericColumns: [1] },
      );
      const sheet = await hoja(body);

      expect(sheet.getCell("B2").value).toBe("12 pzas");
      expect(sheet.getCell("B3").value).toBe("—");
    });

    it("la COLUMNA de texto también tiene formato Texto, para lo que se teclee después", async () => {
      const { body } = await serializeSpreadsheet(FILAS_MIXTAS, "xlsx", { numericColumns: [2] });
      const sheet = await hoja(body);

      expect(sheet.getColumn(1).numFmt).toBe("@");
      expect(sheet.getColumn(2).numFmt).toBe("@");
      expect(sheet.getColumn(3).numFmt).not.toBe("@");
      // Una celda que todavía no existe hereda el formato de su columna.
      expect(sheet.getCell("A20").numFmt).toBe("@");
    });

    it("sin numericColumns, TODAS las columnas van en formato Texto", async () => {
      const { body } = await serializeSpreadsheet(FILAS_MIXTAS, "xlsx");
      const sheet = await hoja(body);

      expect(sheet.getCell("C2").value).toBe("22.5");
      expect(sheet.getCell("C2").numFmt).toBe("@");
      expect(sheet.getColumn(3).numFmt).toBe("@");
    });

    it("el encabezado no se toca: texto, en negrita, congelado y sin formato Texto", async () => {
      const { body } = await serializeSpreadsheet(FILAS_MIXTAS, "xlsx", { numericColumns: [2] });
      const sheet = await hoja(body);

      expect(sheet.getCell("A1").value).toBe("sku");
      expect(sheet.getCell("C1").value).toBe("costo");
      expect(sheet.getCell("A1").font?.bold).toBe(true);
      expect(sheet.getCell("C1").font?.bold).toBe(true);
      expect(sheet.getCell("A1").numFmt).not.toBe("@");
      expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    });

    it("lo exportado se vuelve a leer igual: el número 22.5 regresa como «22.5»", async () => {
      const { body } = await serializeSpreadsheet(FILAS_MIXTAS, "xlsx", { numericColumns: [2] });

      expect(await parseSpreadsheet(body.toString("base64"), "xlsx")).toEqual(FILAS_MIXTAS);
    });

    it("el CSV sale byte por byte igual que antes, con o sin numericColumns", async () => {
      const bom = String.fromCharCode(0xfeff);
      const esperado = `${bom}sku,nombre,costo\n001000000018,Paracetamol,22.5\n0042,Ibuprofeno,`;

      const conOpcion = await serializeSpreadsheet(FILAS_MIXTAS, "csv", { numericColumns: [2] });
      const sinOpcion = await serializeSpreadsheet(FILAS_MIXTAS, "csv");

      expect(conOpcion.body.toString("utf8")).toBe(esperado);
      expect(sinOpcion.body.equals(conOpcion.body)).toBe(true);
    });
  });

  describe("columnIndexes", () => {
    it("da la posición de cada columna pedida, en el orden del encabezado", () => {
      expect(columnIndexes(["sku", "costo", "nombre", "precio"], ["precio", "costo"])).toEqual([
        1, 3,
      ]);
    });

    it("una columna que no está en el encabezado no aporta nada", () => {
      expect(columnIndexes(["sku", "contado"], ["cantidad", "contado"])).toEqual([1]);
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
