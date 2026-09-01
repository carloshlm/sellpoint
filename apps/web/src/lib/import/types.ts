/**
 * El reporte que devuelve toda importación por planilla — espejo de
 * `catalogs/import-engine` del API. Una sola forma para productos, servicios,
 * almacenes y subcatálogos: es lo que permite que un solo diálogo los sirva.
 */
export interface ImportReport {
  valid: number;
  failed: number;
  created: number;
  updated: number;
  errors: ImportRowError[];
  applied: boolean;
}

export interface ImportRowError {
  row: number;
  field?: string;
  /** La clave i18n cruda. */
  message: string;
  /** El texto en el idioma del usuario: el backend traduce. */
  translated?: string;
  /** El código de la fila, si lo trae: para encontrarla en el Excel sin contar renglones. */
  itemCode?: string;
}

export interface ImportRunInput {
  content: string;
  dryRun?: boolean;
  skipErrors?: boolean;
}
