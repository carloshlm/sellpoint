import type { Locale } from "@sellpoint/shared";

/**
 * El nombre del archivo que se descarga, en el idioma de quien lo pide
 * (Carlos, 2026-09-05). Las CLAVES son los nombres de siempre, en español:
 * cada plantilla y cada reporte pide el suyo y recibe la etiqueta del
 * idioma. Una clave desconocida vuelve tal cual, para no inventar nombres.
 */
const ENGLISH: Record<string, string> = {
  productos: "products",
  gastos: "expenses",
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
  proveedores: "suppliers",
};

export function spreadsheetFilenameBase(key: string, locale: Locale): string {
  return locale === "en" ? (ENGLISH[key] ?? key) : key;
}

/**
 * El nombre de la PESTAÑA del Excel, también en el idioma de quien descarga
 * (Carlos, 2026-09-12: bajó la plantilla con una cuenta en Canadá y la hoja
 * decía «Proveedores»). Va aparte del nombre de archivo porque no es el mismo
 * texto: el archivo es `suppliers.xlsx` y la hoja, «Suppliers» — con
 * mayúscula, espacios y acentos donde toque. Una clave desconocida vuelve tal
 * cual, para no inventar nombres.
 */
const SHEET_NAMES: Record<string, string> = {
  Productos: "Products",
  Servicios: "Services",
  Almacenes: "Warehouses",
  Proveedores: "Suppliers",
  "Estudios de laboratorio": "Lab studies",
  "Estudios diagnósticos": "Diagnostic studies",
};

export function spreadsheetSheetName(nombreEnEspanol: string, locale: Locale): string {
  return locale === "en" ? (SHEET_NAMES[nombreEnEspanol] ?? nombreEnEspanol) : nombreEnEspanol;
}
