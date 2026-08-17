import ExcelJS from "exceljs";
import { parseCsv, toCsv } from "./csv";

/**
 * Capa de planillas de la importación (F2-IMPORT, ampliado el 2026-08-16 a
 * pedido de Carlos).
 *
 * El service trabaja con FILAS (`string[][]`) y no sabe en qué formato vino ni
 * en cuál se va. Esa separación es lo que hizo que sumar `.xlsx` fuera agregar
 * un serializador, no reescribir la importación — era justamente el motivo por
 * el que el CSV original se escribió así.
 *
 * `.xlsx` viaja en base64 porque es binario y el endpoint recibe JSON; el CSV
 * viaja como texto plano.
 */
export type SpreadsheetFormat = "csv" | "xlsx";

/** Nombre de la hoja. Fijo: el parser lee la PRIMERA, no busca por nombre. */
const SHEET_NAME = "Productos";

export async function parseSpreadsheet(
  content: string,
  format: SpreadsheetFormat,
): Promise<string[][]> {
  if (format === "csv") {
    return parseCsv(content);
  }

  const workbook = new ExcelJS.Workbook();
  // exceljs declara `interface Buffer extends ArrayBuffer` en el scope GLOBAL y
  // eso choca con el `Buffer` de @types/node. El cast es al tipo que el propio
  // método pide, no un `any`: si la firma cambia, esto vuelve a fallar.
  type XlsxInput = Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(Buffer.from(content, "base64") as unknown as XlsxInput);

  // La PRIMERA hoja, sea cual sea su nombre: quien exporta desde Excel a veces
  // la renombra, y fallar por eso sería hostil.
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return [];
  }

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    // `row.values` es 1-based y su índice 0 viene vacío — de ahí el slice.
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    for (const value of values) {
      cells.push(cellToString(value));
    }
    rows.push(cells);
  });

  return rows.filter((line) => line.some((cell) => cell.trim().length > 0));
}

export async function serializeSpreadsheet(
  rows: readonly (readonly string[])[],
  format: SpreadsheetFormat,
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  if (format === "csv") {
    return {
      body: Buffer.from(toCsv(rows), "utf8"),
      contentType: "text/csv; charset=utf-8",
      filename: "productos.csv",
    };
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);

  for (const row of rows) {
    sheet.addRow([...row]);
  }

  // El encabezado en negrita y congelado: con cientos de productos, perder de
  // vista qué columna es cuál es el problema real de una planilla larga.
  const header = sheet.getRow(1);
  header.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  // Ancho por contenido, acotado: sin esto todas las columnas salen angostas y
  // el usuario tiene que ensancharlas a mano antes de poder leer nada.
  sheet.columns.forEach((column, index) => {
    const longest = rows.reduce((max, row) => Math.max(max, (row[index] ?? "").length), 0);
    column.width = Math.min(40, Math.max(12, longest + 2));
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    body: Buffer.from(buffer),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: "productos.xlsx",
  };
}

/**
 * Excel devuelve tipos ricos donde el importador espera texto: fechas, fórmulas
 * con su resultado calculado, hipervínculos y texto con formato por tramos.
 * Aplanar todo a string acá evita que el service tenga que conocerlos.
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    const rich = value as {
      text?: string;
      result?: unknown;
      richText?: { text: string }[];
      hyperlink?: string;
    };
    if (Array.isArray(rich.richText)) {
      return rich.richText.map((part) => part.text).join("");
    }
    if (rich.result !== undefined) {
      // Fórmula: se toma su RESULTADO, no la fórmula en sí.
      return cellToString(rich.result);
    }
    if (typeof rich.text === "string") {
      return rich.text;
    }
    return "";
  }
  return String(value);
}
