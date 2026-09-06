import type { Locale } from "@sellpoint/shared";

/**
 * El nombre del archivo que se descarga, en el idioma de quien lo pide
 * (Carlos, 2026-09-05). Las CLAVES son los nombres de siempre, en español:
 * cada plantilla y cada reporte pide el suyo y recibe la etiqueta del
 * idioma. Una clave desconocida vuelve tal cual, para no inventar nombres.
 */
const ENGLISH: Record<string, string> = {
  productos: "products",
  servicios: "services",
  almacenes: "warehouses",
  registros: "records",
  "estudios-laboratorio": "lab-studies",
  "estudios-diagnosticos": "diagnostic-studies",
  "conteo-fisico": "physical-count",
  plantilla: "template",
  usuarios: "users",
  catalogo: "catalog",
  ventas: "sales",
  kardex: "kardex",
  stock: "stock",
  "stock-por-lote": "stock-by-lot",
  vencimientos: "expiring",
  "en-transito": "in-transit",
  "cierres-de-turno": "shift-closes",
  impuestos: "taxes",
};

export function spreadsheetFilenameBase(key: string, locale: Locale): string {
  return locale === "en" ? (ENGLISH[key] ?? key) : key;
}
