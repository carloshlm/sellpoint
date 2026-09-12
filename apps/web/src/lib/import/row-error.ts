import type { TFunction } from "i18next";

/** Lo mínimo que una línea del reporte necesita para ubicarse en la planilla. */
export interface RowErrorLocation {
  row: number;
  /** La COLUMNA de la planilla que falló, con el nombre exacto del encabezado. */
  field?: string;
  /** El código de la fila (sku o código interno), cuando la fila lo trae. */
  itemCode?: string;
}

/**
 * Una línea del reporte de importación, ubicada en la planilla.
 *
 * Carlos (2026-09-12): dieciséis filas decían «Este campo es obligatorio» sin
 * decir CUÁL campo — el API ya mandaba la columna (`field`) desde siempre, pero
 * ningún diálogo la pintaba. Con fila, código y columna, el error se encuentra
 * en el Excel sin adivinar: la fila con un Ctrl+F del código y la celda con el
 * encabezado.
 *
 * `field` viaja con el nombre CRUDO del encabezado (`unidad_base`, `costo`, o
 * la clave de un campo propio del catálogo): es exactamente lo que el usuario
 * tiene escrito en la primera fila de su planilla, y traducirlo lo alejaría de
 * lo que ve. Las cuatro claves viven en `common.import` porque el texto es el
 * mismo para todo catálogo.
 */
export function rowErrorText(t: TFunction, error: RowErrorLocation, message: string): string {
  const params = { row: error.row, code: error.itemCode, column: error.field, message };
  const conCodigo = error.itemCode !== undefined && error.itemCode !== "";
  const conColumna = error.field !== undefined && error.field !== "";
  if (conCodigo && conColumna) {
    return t("common.import.rowErrorWithCodeAndColumn", params);
  }
  if (conCodigo) {
    return t("common.import.rowErrorWithCode", params);
  }
  if (conColumna) {
    return t("common.import.rowErrorWithColumn", params);
  }
  return t("common.import.rowError", params);
}
