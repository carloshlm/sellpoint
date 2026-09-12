import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import type { I18nService } from "nestjs-i18n";
import { canonicalHeader } from "../../common/spreadsheet/import-headers";
import { parseSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import type { Prisma } from "../../generated/prisma/client";
import { deriveFieldKey } from "./field-key";
import type { FieldDefinition } from "./validate-attributes";

/**
 * El motor COMPARTIDO de las importaciones por planilla (2026-09-01).
 *
 * ── Por qué existe ──────────────────────────────────────────────────────
 *
 * El importador de productos (F2) nació primero; el de servicios lo espejó
 * "en versión mínima" con la nota de que compartir exigía refactorizar en
 * caliente. Con almacenes y subcatálogos llegan el tercero y el cuarto, y
 * cuatro copias de la misma maquinaria son cuatro lugares donde un bug de
 * lookups se arregla tres veces y se olvida una. Lo que es IGUAL en todos
 * vive acá; lo que es genuinamente distinto —qué columnas estándar tiene
 * cada catálogo y cómo se escribe su tabla— se queda en cada importador.
 *
 * ── Lo que es igual ─────────────────────────────────────────────────────
 *
 *  · leer el Excel (tamaño, ilegible, vacío) y partirlo en encabezado + filas;
 *  · los campos personalizados del catálogo, en el orden de la pantalla;
 *  · el índice de LOOKUPS: en la planilla va el CÓDIGO del subcatálogo, nunca
 *    el id — la planilla es la frontera con la persona;
 *  · resolver las celdas personalizadas de una fila a `attributes`;
 *  · escribir esas mismas celdas de vuelta (plantilla = catálogo actual);
 *  · traducir los errores al idioma del usuario (el backend traduce: la infra
 *    i18n sirve a cualquier cliente del API, no solo a la SPA).
 */

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
  translated?: string;
  /** El código de la fila, si lo trae: para encontrarla en el Excel sin contar renglones. */
  itemCode?: string;
}

/** Traducción código ⇄ id de un subcatálogo apuntado por un campo lookup. */
export interface LookupIndex {
  /** id → código, para escribir la plantilla. */
  codeById: Map<string, string>;
  /** código exacto → id. */
  idByCode: Map<string, string>;
  /** código en minúsculas → id, o `null` si dos códigos colisionan al bajarlos. */
  idByLowerCode: Map<string, string | null>;
}

export interface ImportWorkbook {
  /** El encabezado tal cual vino, recortado. */
  header: string[];
  /** Solo las filas de datos: el encabezado ya no está. */
  rows: string[][];
}

/**
 * Lee la planilla en base64 y la parte en encabezado + filas, con los tres
 * rechazos que todo importador comparte. Las claves i18n son del LLAMADOR:
 * cada módulo reporta con su prefijo (`services.import_unreadable`…).
 */
export async function readImportWorkbook(
  content: string,
  options: {
    maxBytes: number;
    messages: { tooLarge: string; unreadable: string; empty: string };
  },
): Promise<ImportWorkbook> {
  // Se mide el contenido REAL: en base64 un archivo pesa ~33% más y el límite
  // terminaría siendo otro del que dice ser.
  if (Buffer.from(content, "base64").byteLength > options.maxBytes) {
    throw new PayloadTooLargeException({ message: options.messages.tooLarge });
  }
  let rows: string[][];
  try {
    rows = await parseSpreadsheet(content, "xlsx");
  } catch {
    throw new BadRequestException({ message: options.messages.unreadable });
  }
  if (rows.length < 2) {
    throw new BadRequestException({ message: options.messages.empty });
  }
  return {
    header: rows[0]?.map((cell) => canonicalHeader(cell)) ?? [],
    rows: rows.slice(1),
  };
}

/** Los campos VIGENTES del catálogo, en el orden en que la pantalla los pinta. */
export async function loadImportFields(
  tx: Prisma.TransactionClient,
  catalogId: string,
): Promise<FieldDefinition[]> {
  const fields = await tx.catalogField.findMany({
    where: { catalogId },
    select: {
      key: true,
      label: true,
      fieldType: true,
      required: true,
      isArchived: true,
      lookupCatalogId: true,
    },
    orderBy: [{ position: "asc" }, { label: "asc" }],
  });
  return fields.filter((field) => !field.isArchived);
}

/**
 * Un índice por campo lookup. Se leen TODOS los registros de los subcatálogos
 * apuntados en una consulta: resolverlos fila por fila sería N+1 sobre una
 * planilla de 400 líneas.
 */
export async function loadLookupIndexes(
  tx: Prisma.TransactionClient,
  fields: readonly FieldDefinition[],
): Promise<Map<string, LookupIndex>> {
  const lookupFields = fields.filter(
    (field) => field.fieldType === "lookup" && field.lookupCatalogId,
  );
  if (lookupFields.length === 0) {
    return new Map();
  }
  const catalogIds = [...new Set(lookupFields.map((field) => field.lookupCatalogId as string))];
  const records = await tx.catalogRecord.findMany({
    where: { catalogId: { in: catalogIds }, isActive: true },
    select: { id: true, catalogId: true, code: true },
  });

  const byCatalog = new Map<string, LookupIndex>();
  for (const catalogId of catalogIds) {
    byCatalog.set(catalogId, {
      codeById: new Map(),
      idByCode: new Map(),
      idByLowerCode: new Map(),
    });
  }
  for (const record of records) {
    const index = byCatalog.get(record.catalogId);
    if (!index) {
      continue;
    }
    index.codeById.set(record.id, record.code);
    index.idByCode.set(record.code, record.id);
    // `kg` y `KG` pueden convivir en un subcatálogo. Si pasa, el índice laxo
    // marca la ambigüedad con `null`: mejor no adivinar cuál quiso la persona.
    const lower = record.code.toLowerCase();
    index.idByLowerCode.set(lower, index.idByLowerCode.has(lower) ? null : record.id);
  }

  const porCampo = new Map<string, LookupIndex>();
  for (const field of lookupFields) {
    const index = byCatalog.get(field.lookupCatalogId as string);
    if (index) {
      porCampo.set(field.key, index);
    }
  }
  return porCampo;
}

/** Cómo se llama cada campo propio en la planilla de ESTA persona. */
export interface CustomColumns {
  /** El encabezado del archivo, con las columnas propias normalizadas a su `key`. */
  header: string[];
  /**
   * El nombre de la columna tal como la persona la ve: la celda de SU archivo
   * si la trajo, y si no, la etiqueta actual del campo. Es lo que se reporta
   * en un error de fila — decirle `proveedor` a quien tiene escrito
   * «Vendedores» lo manda a buscar una columna que no existe.
   */
  nameOf: (key: string) => string;
}

/**
 * Resuelve el encabezado de un archivo contra los campos propios del catálogo.
 *
 * Carlos (2026-09-12): renombró un campo y la plantilla siguió diciendo el
 * nombre viejo, porque el encabezado se escribía con la `key` —que es
 * IMMUTABLE por diseño: es dónde vive el dato dentro de `attributes`— en vez
 * de con la etiqueta. La plantilla es una superficie que lee un humano: lleva
 * la etiqueta. Para que eso no rompa los archivos ya descargados, acá se
 * acepta cualquiera de las tres formas de nombrar la columna —la etiqueta de
 * hoy, su slug y la key histórica— y todas se normalizan a la key.
 *
 * De paso corrige una trampa vieja: `canonicalHeader` respeta las mayúsculas
 * de una columna que no conoce, así que un encabezado «Proveedor» no casaba
 * con la key `proveedor` y la columna entera se ignoraba en silencio — la
 * fila terminaba diciendo «este campo es obligatorio» con el dato escrito al
 * lado. La comparación es por slug, que ignora mayúsculas y acentos.
 */
export function resolveCustomColumns(
  header: readonly string[],
  fields: readonly FieldDefinition[],
): CustomColumns {
  const porSlug = new Map<string, string | null>();
  // La key primero y con prioridad: ante un empate entre «la key de A» y «la
  // etiqueta de B», manda dónde vive el dato. Una key es prueba exacta; una
  // etiqueta, una coincidencia de nombre.
  const porKey = new Set<string>();
  for (const field of fields) {
    const slug = slugSeguro(field.key);
    if (slug !== null) {
      porSlug.set(slug, field.key);
      porKey.add(slug);
    }
  }
  for (const field of fields) {
    const slug = slugSeguro(field.label);
    if (slug === null || porKey.has(slug)) {
      continue;
    }
    // Dos ETIQUETAS que reclaman el mismo nombre: no se adivina cuál quiso la
    // persona, se deja la columna como vino y el campo se reporta vacío.
    porSlug.set(slug, porSlug.has(slug) && porSlug.get(slug) !== field.key ? null : field.key);
  }

  const normalizado: string[] = [];
  const enElArchivo = new Map<string, string>();
  for (const celda of header) {
    const key = porSlug.get(slugSeguro(celda) ?? "") ?? null;
    normalizado.push(key ?? celda);
    if (key !== null && !enElArchivo.has(key)) {
      enElArchivo.set(key, celda.trim());
    }
  }

  const etiquetas = new Map(fields.map((field) => [field.key, field.label]));
  return {
    header: normalizado,
    nameOf: (key) => enElArchivo.get(key) ?? etiquetas.get(key) ?? key,
  };
}

/** El slug de un texto, o `null` si no deja nada usable (una celda de guiones). */
function slugSeguro(texto: string): string | null {
  try {
    return deriveFieldKey(texto);
  } catch {
    return null;
  }
}

/** Los encabezados que la PLANTILLA escribe para los campos propios: sus etiquetas. */
export function customHeaderLabels(fields: readonly FieldDefinition[]): string[] {
  return fields.map((field) => field.label);
}

/** El código de la planilla → id del registro, exacto primero y laxo después. */
export function resolveLookupCode(index: LookupIndex, raw: string): string | null {
  return index.idByCode.get(raw) ?? index.idByLowerCode.get(raw.toLowerCase()) ?? null;
}

/**
 * Las celdas PERSONALIZADAS de una fila → `attributes`. Solo las columnas que
 * son campos vigentes del catálogo; lo demás se ignora (una columna de más en
 * el Excel no es un error, es una nota al margen). Devuelve el primer lookup
 * que no resuelve, para que el importador lo reporte con su fila.
 */
export function parseCustomAttributes(
  header: readonly string[],
  cellOf: (column: string) => string,
  fields: readonly FieldDefinition[],
  lookups: Map<string, LookupIndex>,
): { attributes: Record<string, unknown>; lookupError: string | null } {
  const knownKeys = new Set(fields.map((field) => field.key));
  const attributes: Record<string, unknown> = {};
  for (const column of header) {
    if (!knownKeys.has(column)) {
      continue;
    }
    const raw = cellOf(column);
    if (!raw) {
      continue;
    }
    const index = lookups.get(column);
    if (index) {
      const resolved = resolveLookupCode(index, raw);
      if (!resolved) {
        return { attributes, lookupError: column };
      }
      attributes[column] = resolved;
      continue;
    }
    const field = fields.find((item) => item.key === column);
    attributes[column] = field?.fieldType === "number" ? Number(raw) : raw;
  }
  return { attributes, lookupError: null };
}

/**
 * `attributes` → las celdas personalizadas de la plantilla, con los lookups
 * de vuelta a su CÓDIGO. Lo que sale por acá tiene que poder reimportarse.
 */
export function customCells(
  attributes: Record<string, unknown>,
  customKeys: readonly string[],
  lookups: Map<string, LookupIndex>,
): string[] {
  return customKeys.map((key) => {
    const value = attributes[key];
    if (value === undefined || value === null) {
      return "";
    }
    const index = lookups.get(key);
    if (!index) {
      return String(value);
    }
    return index.codeById.get(String(value)) ?? "";
  });
}

/** Los errores con su texto en el idioma del usuario; la clave cruda se conserva. */
export function translateImportErrors(
  i18n: I18nService,
  errors: readonly ImportRowError[],
  locale: Locale,
): ImportRowError[] {
  return errors.map((error) => {
    const translated = i18n.translate(error.message, { lang: locale });
    return { ...error, translated: typeof translated === "string" ? translated : error.message };
  });
}

/**
 * F4-TAX-11 — el índice `código ↔ id` de los grupos de impuesto del negocio,
 * para la columna `impuesto` de las cuatro plantillas. Incluye los grupos
 * INACTIVOS: un artículo que sigue apuntando a uno exporta su código y tiene
 * que poder volver a subirse sin pérdida.
 */
export interface TaxGroupIndex {
  idByCode: Map<string, string>;
  codeById: Map<string, string>;
  /** El código del default activo, para la fila de ejemplo de la plantilla. */
  defaultCode: string | null;
}

export async function loadTaxGroupIndex(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<TaxGroupIndex> {
  const grupos = await tx.taxGroup.findMany({
    where: { tenantId },
    select: { id: true, code: true, isDefault: true, isActive: true },
  });
  return {
    idByCode: new Map(grupos.map((g) => [g.code, g.id])),
    codeById: new Map(grupos.map((g) => [g.id, g.code])),
    defaultCode: grupos.find((g) => g.isDefault && g.isActive)?.code ?? null,
  };
}

/**
 * La celda `impuesto`: vacía = hereda el default (escribe NULL); un código =
 * ese grupo; desconocido = error de fila. Vacío significa «heredar» y NO «no
 * tocar» a propósito: es la única semántica con la que bajar → editar →
 * subir es un viaje sin pérdida (si el vacío no tocara, la plantilla tendría
 * que escribir el default en cada fila heredada y un round-trip congelaría a
 * todos los artículos fuera del default).
 */
export function resolveTaxGroupCode(
  index: TaxGroupIndex,
  raw: string,
): { kind: "inherit" } | { kind: "group"; id: string } | { kind: "unknown" } {
  const code = raw.trim().toUpperCase();
  if (code === "") return { kind: "inherit" };
  const id = index.idByCode.get(code);
  return id === undefined ? { kind: "unknown" } : { kind: "group", id };
}
