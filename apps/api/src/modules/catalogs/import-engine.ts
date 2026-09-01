import { BadRequestException, PayloadTooLargeException } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import type { I18nService } from "nestjs-i18n";
import { parseSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import type { Prisma } from "../../generated/prisma/client";
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
    header: rows[0]?.map((cell) => cell.trim()) ?? [],
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
