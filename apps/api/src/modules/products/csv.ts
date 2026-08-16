/**
 * CSV mínimo para la importación de productos (F2-IMPORT).
 *
 * ── Por qué CSV y no un .xlsx binario ───────────────────────────────────
 * El tablero decía "Excel". Se implementó CSV **con BOM UTF-8** porque Excel
 * lo abre y lo guarda de forma nativa —la experiencia de "descargo la
 * plantilla, la lleno en Excel, la subo" es idéntica— y evita meter una
 * dependencia de parseo binario en el API por una funcionalidad que se usa
 * una vez cada tanto. El BOM es lo que hace que Excel muestre bien los
 * acentos en vez de "PrÃ³ducto".
 *
 * Si algún día un cliente exige .xlsx de verdad (formatos, varias hojas), se
 * cambia el serializador sin tocar el resto del flujo: el service trabaja con
 * filas, no con archivos.
 *
 * Estas funciones son PURAS y se testean sin DB ni Nest.
 */

/** BOM UTF-8: sin esto Excel asume Latin-1 y rompe los acentos. */
export const UTF8_BOM = "﻿";

/**
 * Parsea CSV respetando comillas dobles, comas dentro de comillas y saltos de
 * línea dentro de un campo. Un `split(",")` alcanza hasta que alguien escribe
 * un nombre de producto con una coma — y ahí corrompe el archivo entero en
 * silencio.
 */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(UTF8_BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === '"') {
        // `""` dentro de comillas es una comilla literal.
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  // Última fila sin salto de línea final.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((line) => line.some((cell) => cell.trim().length > 0));
}

/** Serializa filas a CSV, citando solo lo que lo necesita. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return (
    UTF8_BOM +
    rows
      .map((row) =>
        row
          .map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
          .join(","),
      )
      .join("\n")
  );
}
