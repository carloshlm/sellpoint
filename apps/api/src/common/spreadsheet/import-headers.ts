import type { Locale } from "@sellpoint/shared";

/**
 * Encabezados de plantillas de importación en el idioma de quien las descarga
 * (Carlos, 2026-09-05).
 *
 * Las CLAVES internas siguen siendo las de siempre, en español: los archivos
 * ya descargados y todos los parsers leen por ese nombre, y renombrarlas
 * rompería ambos. Lo que cambia es la superficie: la plantilla escribe la
 * ETIQUETA del idioma pedido, y todo parser normaliza el encabezado que
 * recibe a la clave interna. Así un archivo con encabezados en inglés se
 * importa igual que uno en español, y hasta uno mezclado.
 *
 * Las columnas personalizadas (campos del catálogo) no se traducen: su nombre
 * lo puso el negocio.
 */
const ENGLISH_LABELS: Record<string, string> = {
  codigo_de_barras: "barcode",
  sku: "sku",
  nombre: "name",
  unidad_base: "base_unit",
  costo: "cost",
  precio: "price",
  stock_minimo: "min_stock",
  ubicacion: "location",
  controla_lotes: "tracks_lots",
  es_compuesto: "is_composite",
  codigo: "code",
  direccion: "address",
  telefono: "phone",
  email: "email",
  descripcion: "description",
  unidad: "unit",
  lote: "lot",
  caducidad: "expiry",
  teorico: "expected",
  contado: "counted",
  presentacion: "presentation",
  cantidad: "quantity",
  costo_unitario: "unit_cost",
};

const CANONICAL_BY_ENGLISH = new Map(
  Object.entries(ENGLISH_LABELS).map(([clave, etiqueta]) => [etiqueta, clave]),
);

/** La etiqueta de una clave interna en el idioma pedido; en español es la clave misma. */
export function headerLabel(key: string, locale: Locale): string {
  return locale === "en" ? (ENGLISH_LABELS[key] ?? key) : key;
}

export function localizeHeaders(keys: readonly string[], locale: Locale): string[] {
  return keys.map((key) => headerLabel(key, locale));
}

/**
 * Un encabezado tal como viene del archivo → la clave interna. Reconoce la
 * etiqueta en inglés (sin distinguir mayúsculas); cualquier otra cosa vuelve
 * recortada, tal cual: puede ser la clave en español o una columna
 * personalizada, y ninguna de las dos se toca.
 */
export function canonicalHeader(cell: string): string {
  const recortado = cell.trim();
  return CANONICAL_BY_ENGLISH.get(recortado.toLowerCase()) ?? recortado;
}
