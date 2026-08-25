import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { getUnit, type Locale } from "@sellpoint/shared";
import { I18nService } from "nestjs-i18n";
import {
  parseSpreadsheet,
  type SpreadsheetFormat,
  serializeSpreadsheet,
} from "../../common/spreadsheet/spreadsheet";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";
import { PRODUCTS_CATALOG_KEY } from "../tenants/role-catalog";
import { hasValidMoneyScale, MONEY_MAX } from "./money";
import { basePresentationName, derivesFractionalInput } from "./products.service";

/** 5 MB de contenido REAL (ya decodificado, no en base64). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const STANDARD_COLUMNS = [
  "sku",
  "nombre",
  "unidad_base",
  "stock_minimo",
  "precio",
  "costo",
  "controla_lotes",
] as const;

export interface ImportRowError {
  row: number;
  /** Ya TRADUCIDO al salir del service. */
  message: string;
  field?: string;
  /** Clave i18n cruda, para que el front discrimine sin parsear texto. */
  code?: string;
}

export interface ImportReport {
  valid: number;
  failed: number;
  errors: ImportRowError[];
  /** Filas que se van a crear / se crearon. */
  created: number;
  /** Filas que actualizan un producto que YA existe (round-trip). */
  updated: number;
  imported: number;
}

/**
 * Traducción entre lo que ve el humano (el **código** del registro) y lo que se
 * guarda (su **id**). El id se queda como está en `attributes`: es estable ante
 * renombres, mientras que el código es justamente lo que el tenant puede
 * cambiar. La planilla es la frontera con la persona, así que la conversión
 * vive acá y no en el modelo.
 */
interface LookupIndex {
  /** id → código, para escribir la plantilla. */
  codeById: Map<string, string>;
  /** código exacto → id. */
  idByCode: Map<string, string>;
  /** código en minúsculas → id, o `null` si dos códigos colisionan al bajarlos. */
  idByLowerCode: Map<string, string | null>;
}

/**
 * Una celda de sí/no de la planilla. Acepta las formas que de verdad escribe
 * la gente —y las que emite Excel según el idioma— porque rechazar "SI" por no
 * ser "true" sería pedirle al usuario que hable como la base de datos.
 *
 * Vacío devuelve `null` y NO es `false`: "no vino el dato" y "vino que no" son
 * cosas distintas. Confundirlas apagaría el control de lote de todo producto
 * cuya planilla simplemente no traiga la columna.
 */
function parseBooleanCell(raw: string): boolean | null {
  const value = raw.trim().toLowerCase();
  if (value === "") {
    return null;
  }
  return ["si", "sí", "yes", "true", "1", "x", "verdadero"].includes(value);
}

interface ParsedRow {
  row: number;
  sku: string;
  name: string;
  baseUnit: string;
  stockMin: number;
  price: number | null;
  cost: number | null;
  /** `null` = la columna no vino: NO se toca lo que ya estaba. */
  tracksLots: boolean | null;
  attributes: Record<string, unknown>;
  existingId: string | null;
}

/**
 * F2-IMPORT — plantilla, validación previa e importación. CSV y XLSX.
 *
 * ── La plantilla trae los productos existentes (Carlos, 2026-08-16) ──────
 * Descargarla vacía servía para dar de alta, pero no para CORREGIR: un negocio
 * con 400 productos que quiere retocar precios tenía que escribirlos de nuevo.
 * Ahora la plantilla ES el catálogo, y eso obliga a una decisión:
 *
 * **la importación pasó a ser UPSERT.** Un SKU que ya existe ACTUALIZA en vez
 * de fallar con 409. Sin eso, bajar la plantilla y volver a subirla —el flujo
 * que se pidió— fallaría en TODAS las filas. El reporte separa `created` de
 * `updated` para que el usuario vea qué va a pasar antes de confirmar.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * F2-IMPORT-01. Columnas = campos VIGENTES del catálogo; filas = productos
   * ya dados de alta. Descargar, editar y volver a subir es el camino
   * principal, no un truco.
   */
  async template(
    user: AuthUser,
    format: SpreadsheetFormat,
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const { header, rows, custom } = await this.catalogRows(user);

    // Sin productos todavía, una fila de ejemplo: si no, nadie sabe si el
    // precio va con punto o con coma, ni qué se espera en "unidad_base".
    //
    // Es lo que separa a la PLANTILLA del reporte de catálogo (F5-CAT-03):
    // acá el archivo enseña un formato, allá informa lo que hay. Inventar un
    // «Paracetamol» en un reporte sería decir que existe un producto que
    // nadie dio de alta.
    const body =
      rows.length > 0
        ? rows
        : [["PAR-500", "Paracetamol 500mg", "unit", "0", "15.50", "9.00", ...custom.map(() => "")]];

    return serializeSpreadsheet([header, ...body], format);
  }

  /**
   * El catálogo COMPLETO como filas, con sus campos dinámicos resueltos a
   * códigos legibles.
   *
   * Lo comparten la plantilla de importación (F2) y el reporte de catálogo
   * (F5-CAT-03) para que las columnas no puedan divergir: si fueran dos
   * listas, un día dirían cosas distintas y lo exportado dejaría de poder
   * reimportarse.
   */
  async catalogRows(
    user: AuthUser,
  ): Promise<{ header: string[]; rows: string[][]; custom: string[] }> {
    const fields = await this.loadFields(user);
    const active = fields.filter((field) => !field.isArchived);
    const custom = active.map((field) => field.key);
    const header = [...STANDARD_COLUMNS, ...custom];
    const lookups = await this.loadLookupIndexes(user, active);

    const products = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.product.findMany({
        orderBy: { sku: "asc" },
        include: {
          presentations: {
            where: { isDefaultSale: true },
            select: { price: true, cost: true },
            take: 1,
          },
        },
      }),
    );

    const rows = products.map((product) => {
      const attributes = (product.attributes ?? {}) as Record<string, unknown>;
      const base = product.presentations[0];
      return [
        product.sku,
        product.name,
        product.baseUnit,
        product.stockMin.toString(),
        base?.price?.toString() ?? "",
        base?.cost?.toString() ?? "",
        ...custom.map((key) => {
          const value = attributes[key];
          if (value === undefined || value === null) {
            return "";
          }
          const index = lookups.get(key);
          if (!index) {
            return String(value);
          }
          // El id apunta a un registro que ya no está (borrado o inactivo): se
          // deja la celda vacía. Escribir el UUID sería mostrar basura, y
          // volver a subirlo la reviviría.
          return index.codeById.get(String(value)) ?? "";
        }),
      ];
    });

    return { header, rows, custom };
  }

  async run(
    user: AuthUser,
    content: string,
    options: {
      format: SpreadsheetFormat;
      dryRun: boolean;
      skipErrors: boolean;
      locale: Locale;
    },
    meta: RequestMeta,
  ): Promise<ImportReport> {
    // Se mide el contenido REAL: en base64 un archivo pesa ~33% más y el
    // límite terminaría siendo otro del que dice ser.
    const bytes =
      options.format === "xlsx"
        ? Buffer.from(content, "base64").byteLength
        : Buffer.byteLength(content, "utf8");
    if (bytes > MAX_IMPORT_BYTES) {
      // Diferido a propósito: procesar asíncrono exige un sistema de
      // notificaciones que todavía no existe (IMPLEMENTACION.md, F2).
      throw new PayloadTooLargeException({ message: "products.import_too_large" });
    }

    // Un archivo corrupto (o un .csv renombrado a .xlsx) hace fallar al parser
    // binario: es un problema del archivo del usuario, no del servidor.
    let rows: string[][];
    try {
      rows = await parseSpreadsheet(content, options.format);
    } catch {
      throw new BadRequestException({ message: "products.import_unreadable" });
    }

    if (rows.length < 2) {
      throw new BadRequestException({ message: "products.import_empty" });
    }

    const header = rows[0]?.map((cell) => cell.trim()) ?? [];
    const fields = await this.loadFields(user);
    const active = fields.filter((field) => !field.isArchived);
    const knownKeys = new Set(active.map((f) => f.key));
    const lookups = await this.loadLookupIndexes(user, active);

    const errors: ImportRowError[] = [];
    const parsed: Omit<ParsedRow, "existingId">[] = [];
    const seenSkus = new Set<string>();

    for (let index = 1; index < rows.length; index += 1) {
      // +1 porque la fila 1 es el encabezado: el número que se reporta es el
      // que el usuario ve en su planilla.
      const rowNumber = index + 1;
      const cells = rows[index] ?? [];
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();

      const sku = value("sku");
      const name = value("nombre");

      if (!sku || !name) {
        errors.push({ row: rowNumber, message: "products.import_missing_required" });
        continue;
      }

      // Duplicado DENTRO del archivo: sigue siendo error aunque ahora exista
      // el upsert — dos filas con el mismo SKU es una planilla mal armada, no
      // una intención.
      if (seenSkus.has(sku)) {
        errors.push({ row: rowNumber, field: "sku", message: "products.import_duplicate_sku" });
        continue;
      }
      seenSkus.add(sku);

      const baseUnit = value("unidad_base") || "unit";
      if (!getUnit(baseUnit)) {
        errors.push({ row: rowNumber, field: "unidad_base", message: "products.unknown_unit" });
        continue;
      }

      const attributes: Record<string, unknown> = {};
      let lookupError: ImportRowError | null = null;
      for (const column of header) {
        if (!knownKeys.has(column)) {
          continue;
        }
        const raw = value(column);
        if (!raw) {
          continue;
        }

        const index = lookups.get(column);
        if (index) {
          // En la planilla va el CÓDIGO del subcatálogo, nunca el id. Se
          // traduce acá: adentro se sigue guardando el id.
          const resolved = resolveLookupCode(index, raw);
          if (!resolved) {
            lookupError = {
              row: rowNumber,
              field: column,
              message: "catalogs.lookup_value_not_found",
            };
            break;
          }
          attributes[column] = resolved;
          continue;
        }

        const field = fields.find((item) => item.key === column);
        attributes[column] = field?.fieldType === "number" ? Number(raw) : raw;
      }

      if (lookupError) {
        errors.push(lookupError);
        continue;
      }

      const attributeErrors = validateRecordAttributes(
        fields.filter((field) => knownKeys.has(field.key)),
        attributes,
      );
      if (attributeErrors.length > 0) {
        errors.push({
          row: rowNumber,
          field: attributeErrors[0]?.key,
          message: attributeErrors[0]?.message ?? "products.invalid_attributes",
        });
        continue;
      }

      // Importes con más de dos decimales: la planilla es justamente donde más
      // fácil se cuelan (una división en Excel deja 12 decimales sin que nadie
      // los vea) y donde el redondeo silencioso de Postgres pasa más
      // desapercibido, porque nadie revisa 400 filas a ojo.
      const money: Record<string, number | null> = { precio: null, costo: null };
      let moneyError: ImportRowError | null = null;
      for (const column of ["precio", "costo"]) {
        const raw = value(column);
        if (!raw) {
          continue;
        }
        const amount = Number(raw);
        if (!hasValidMoneyScale(amount)) {
          // Se distingue el motivo: decir "2 decimales" cuando lo que no entra
          // es la magnitud manda al usuario a buscar en el lugar equivocado.
          const message =
            Math.abs(amount) > MONEY_MAX
              ? "products.amount_too_large"
              : "products.too_many_decimals";
          moneyError = { row: rowNumber, field: column, message };
          break;
        }
        money[column] = amount;
      }

      if (moneyError) {
        errors.push(moneyError);
        continue;
      }

      parsed.push({
        row: rowNumber,
        sku,
        name,
        baseUnit,
        stockMin: Number(value("stock_minimo")) || 0,
        price: money.precio ?? null,
        cost: money.costo ?? null,
        tracksLots: parseBooleanCell(value("controla_lotes")),
        attributes,
      });
    }

    // Qué SKUs ya existen: define quién se crea y quién se actualiza.
    const existing = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.product.findMany({
        where: { sku: { in: parsed.map((item) => item.sku) } },
        select: { id: true, sku: true },
      }),
    );
    const idBySku = new Map(existing.map((product) => [product.sku, product.id]));
    const conId: ParsedRow[] = parsed.map((item) => ({
      ...item,
      existingId: idBySku.get(item.sku) ?? null,
    }));

    // La importación escribe con `tx.product.update` DIRECTO, así que no pasa
    // por la guarda de `ProductsService.update`. Sin esto, una planilla podría
    // apagar el control de lote de un producto CON saldo y romper en silencio
    // la invariante `Σ stock_lots == stock_by_warehouse` — justo lo que el 409
    // del formulario evita. El error va POR FILA, como todo en la importación.
    const apagando = conId.filter((item) => item.tracksLots === false && item.existingId !== null);
    const bloqueados = new Set<string>();
    if (apagando.length > 0) {
      const ids = apagando.map((item) => item.existingId as string);
      const conSaldo = await this.prisma.withTenantContext(user.tenantId, (tx) =>
        tx.stockLot.findMany({
          where: { quantity: { gt: 0 }, lot: { productId: { in: ids } } },
          select: { lot: { select: { productId: true } } },
        }),
      );
      for (const row of conSaldo) {
        bloqueados.add(row.lot.productId);
      }
    }

    const importable: ParsedRow[] = [];
    for (const item of conId) {
      if (item.existingId !== null && bloqueados.has(item.existingId)) {
        errors.push({
          row: item.row,
          field: "controla_lotes",
          message: "products.lots_in_stock",
        });
        continue;
      }
      importable.push(item);
    }

    const created = importable.filter((item) => !item.existingId).length;
    const updated = importable.length - created;

    const report: ImportReport = {
      valid: importable.length,
      failed: errors.length,
      // Traducidos ACÁ y no en el front: el dry-run responde 200, así que su
      // reporte no pasa por el filtro de excepciones, y la ley del proyecto es
      // que el backend traduce (la infra i18n sirve a cualquier cliente del
      // API, no solo a la SPA — ver `all-exceptions.filter.ts`).
      errors: errors.map((rowError) => ({
        ...rowError,
        message: this.translate(rowError.message, options.locale),
        // `code` mantiene la clave cruda: el front discrimina por ella sin
        // parsear texto, mismo contrato que el filtro de excepciones.
        code: rowError.message,
      })),
      created,
      updated,
      imported: 0,
    };

    if (options.dryRun) {
      return report;
    }

    // Sin `skipErrors` es todo o nada: importar la mitad de un archivo con
    // errores deja al usuario sin saber qué quedó adentro.
    if (errors.length > 0 && !options.skipErrors) {
      throw new BadRequestException({ message: "products.import_has_errors", report });
    }

    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      for (const item of importable) {
        if (item.existingId) {
          // El SKU no se toca: es la LLAVE por la que se reconoció la fila.
          await tx.product.update({
            where: { id: item.existingId },
            data: {
              name: item.name,
              baseUnit: item.baseUnit,
              stockMin: item.stockMin,
              // `null` = la columna no vino: no se toca lo que ya estaba.
              ...(item.tracksLots !== null ? { tracksLots: item.tracksLots } : {}),
              attributes: item.attributes as Prisma.InputJsonValue,
            },
          });

          // Precio y costo viven en la presentación predeterminada: se
          // actualiza esa, no se crea otra (misma regla que el form).
          const base = await tx.productPresentation.findFirst({
            where: { productId: item.existingId, isDefaultSale: true },
            select: { id: true },
          });
          if (base && (item.price !== null || item.cost !== null)) {
            await tx.productPresentation.update({
              where: { id: base.id },
              data: {
                ...(item.price !== null ? { price: item.price } : {}),
                ...(item.cost !== null ? { cost: item.cost } : {}),
              },
            });
          }
          continue;
        }

        const product = await tx.product.create({
          data: {
            tenantId: user.tenantId,
            sku: item.sku,
            name: item.name,
            baseUnit: item.baseUnit,
            stockMin: item.stockMin,
            tracksLots: item.tracksLots ?? false,
            attributes: item.attributes as Prisma.InputJsonValue,
          },
        });

        await tx.productPresentation.create({
          data: {
            tenantId: user.tenantId,
            productId: product.id,
            name: basePresentationName(item.baseUnit, options.locale),
            factor: 1,
            isDefaultSale: true,
            allowFractionalInput: derivesFractionalInput(item.baseUnit),
            price: item.price,
            cost: item.cost,
          },
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "products.import",
        resourceType: "product",
        after: { created, updated, failed: errors.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return { ...report, imported: importable.length };
  }

  /** La clave cruda si no hay entrada: mejor eso que una celda vacía. */
  private translate(key: string, locale: Locale): string {
    const translated = this.i18n.translate(key, { lang: locale });
    return typeof translated === "string" ? translated : key;
  }

  /**
   * Índice `id ↔ código` por cada campo lookup, en UNA sola query para todos los
   * catálogos destino: resolver registro por registro dentro del bucle de filas
   * convertiría un archivo de 400 productos en 400 queries.
   *
   * Solo registros ACTIVOS, igual que el alta por formulario: un archivado no
   * se puede elegir en la UI y tampoco por planilla.
   */
  private async loadLookupIndexes(
    user: AuthUser,
    fields: readonly FieldDefinition[],
  ): Promise<Map<string, LookupIndex>> {
    const lookupFields = fields.filter(
      (field) => field.fieldType === "lookup" && field.lookupCatalogId,
    );
    if (lookupFields.length === 0) {
      return new Map();
    }

    const catalogIds = [...new Set(lookupFields.map((field) => field.lookupCatalogId as string))];
    const records = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.catalogRecord.findMany({
        where: { catalogId: { in: catalogIds }, isActive: true },
        select: { id: true, catalogId: true, code: true },
      }),
    );

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

      // `UNIQUE(catalog_id, code)` es sensible a mayúsculas: "kg" y "KG" pueden
      // convivir. Si eso pasa, el índice laxo se marca ambiguo con `null` y ese
      // código exige coincidencia exacta.
      const lower = record.code.toLowerCase();
      index.idByLowerCode.set(lower, index.idByLowerCode.has(lower) ? null : record.id);
    }

    // Dos campos pueden apuntar al MISMO catálogo: comparten índice.
    const byField = new Map<string, LookupIndex>();
    for (const field of lookupFields) {
      const index = byCatalog.get(field.lookupCatalogId as string);
      if (index) {
        byField.set(field.key, index);
      }
    }
    return byField;
  }

  private async loadFields(user: AuthUser): Promise<FieldDefinition[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await tx.catalog.findFirst({
        where: { tenantId: user.tenantId, systemKey: PRODUCTS_CATALOG_KEY },
        select: { id: true },
      });

      if (!catalog) {
        return [];
      }

      return tx.catalogField.findMany({
        where: { catalogId: catalog.id },
        select: {
          key: true,
          fieldType: true,
          required: true,
          isArchived: true,
          lookupCatalogId: true,
        },
      });
    });
  }
}

/**
 * Código → id. Primero coincidencia exacta; recién si no la hay se prueba sin
 * distinguir mayúsculas, y solo cuando ese código es inequívoco. Escribir `KG`
 * donde el catálogo dice `kg` es un typo, no una intención de crear algo nuevo,
 * y hacer fallar la fila por eso sería hostil sin ganar nada.
 */
function resolveLookupCode(index: LookupIndex, raw: string): string | null {
  return index.idByCode.get(raw) ?? index.idByLowerCode.get(raw.toLowerCase()) ?? null;
}
