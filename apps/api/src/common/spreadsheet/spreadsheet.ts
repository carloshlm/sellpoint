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

/**
 * Los defaults de F2-IMPORT, que nació primero y bautizó todo «Productos».
 * Siguen siendo el comportamiento sin opciones: los llamadores de la
 * importación no cambian ni una línea (F5-CORE-01).
 *
 * El nombre de la hoja no lo lee nadie al PARSEAR —el parser toma la primera,
 * sea cual sea su nombre—; existe para quien abre el archivo en Excel.
 */
const SHEET_NAME = "Productos";
const FILENAME_BASE = "productos";

/** Cómo se bautiza la planilla. Cada opción cae a SU default por separado. */
export interface SpreadsheetOptions {
  /** Nombre de la pestaña en el xlsx. Irrelevante en CSV, que no tiene hojas. */
  sheetName?: string;
  /** Nombre del archivo SIN extensión: la pone el formato. */
  filenameBase?: string;
}

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
      cells.push(cellToString(resolveFormula(sheet, row, value)));
    }
    rows.push(cells);
  });

  return rows.filter((line) => line.some((cell) => cell.trim().length > 0));
}

export async function serializeSpreadsheet(
  rows: readonly (readonly string[])[],
  format: SpreadsheetFormat,
  options: SpreadsheetOptions = {},
): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const base = options.filenameBase ?? FILENAME_BASE;

  if (format === "csv") {
    return {
      body: Buffer.from(toCsv(rows), "utf8"),
      contentType: "text/csv; charset=utf-8",
      filename: `${base}.csv`,
    };
  }

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(options.sheetName ?? SHEET_NAME);

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
    filename: `${base}.xlsx`,
  };
}

/** Una referencia simple a otra celda: `G2`, `$G$2`. Nada más. */
const SIMPLE_REFERENCE = /^\$?([A-Z]{1,3})\$?(\d+)$/;

interface FormulaCell {
  formula?: unknown;
  sharedFormula?: unknown;
  result?: unknown;
}

/**
 * Una fórmula SIN resultado en caché no es lo que Excel escribe —Excel siempre
 * guarda el valor calculado—: es lo que ExcelJS devuelve cuando ese valor es
 * «falsy» (`if (model.value)` en su cell-xform), o sea un 0. En un conteo, un
 * `=G2` que da 0 es «conté cero», no «no conté» (Carlos, 2026-09-01).
 *
 * Se resuelve solo el caso que se puede resolver sin evaluar nada: la fórmula
 * es una referencia simple a una celda de la MISMA fila (la de `=G2`
 * arrastrado hacia abajo). Para una compartida, la fila es la de la celda
 * hija, no la de la maestra. Cualquier otra fórmula queda como estaba.
 */
function resolveFormula(sheet: ExcelJS.Worksheet, row: ExcelJS.Row, value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  const cell = value as FormulaCell;
  if (cell.result !== undefined) {
    return value;
  }
  const formula =
    typeof cell.formula === "string"
      ? cell.formula
      : typeof cell.sharedFormula === "string"
        ? (sheet.getCell(cell.sharedFormula).value as FormulaCell | null)?.formula
        : undefined;
  if (typeof formula !== "string") {
    return value;
  }
  const match = SIMPLE_REFERENCE.exec(formula.trim().toUpperCase());
  if (match === null) {
    return value;
  }
  const [, column, referencedRow] = match;
  if (column === undefined || referencedRow === undefined) {
    return value;
  }
  // La maestra tiene que apuntar a su propia fila para que arrastrarla
  // signifique «la misma columna, en cada fila».
  const masterRow =
    typeof cell.sharedFormula === "string"
      ? Number(sheet.getCell(cell.sharedFormula).row)
      : row.number;
  if (Number(referencedRow) !== masterRow) {
    return value;
  }
  const referenced = row.getCell(column).value;
  // Un solo salto: si la referida también es una fórmula sin caché, no se
  // persigue — se devuelve vacío en vez de adivinar.
  return referenced !== null && typeof referenced === "object" && "formula" in referenced
    ? ""
    : referenced;
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
