import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { getUnit } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";
import { PRODUCTS_CATALOG_KEY } from "../tenants/role-catalog";
import { derivesFractionalInput } from "./products.service";
import { parseSpreadsheet, type SpreadsheetFormat, serializeSpreadsheet } from "./spreadsheet";

/** 5 MB de contenido REAL (ya decodificado, no en base64). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const STANDARD_COLUMNS = [
  "sku",
  "nombre",
  "unidad_base",
  "stock_minimo",
  "precio",
  "costo",
] as const;

export interface ImportRowError {
  row: number;
  message: string;
  field?: string;
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

interface ParsedRow {
  row: number;
  sku: string;
  name: string;
  baseUnit: string;
  stockMin: number;
  price: number | null;
  cost: number | null;
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
    const fields = await this.loadFields(user);
    const custom = fields.filter((field) => !field.isArchived).map((field) => field.key);
    const header = [...STANDARD_COLUMNS, ...custom];

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
          return value === undefined || value === null ? "" : String(value);
        }),
      ];
    });

    // Sin productos todavía, una fila de ejemplo: si no, nadie sabe si el
    // precio va con punto o con coma, ni qué se espera en "unidad_base".
    const body =
      rows.length > 0
        ? rows
        : [["PAR-500", "Paracetamol 500mg", "unit", "0", "15.50", "9.00", ...custom.map(() => "")]];

    return serializeSpreadsheet([header, ...body], format);
  }

  async run(
    user: AuthUser,
    content: string,
    options: { format: SpreadsheetFormat; dryRun: boolean; skipErrors: boolean },
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
    const knownKeys = new Set(fields.filter((field) => !field.isArchived).map((f) => f.key));

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
      for (const column of header) {
        if (!knownKeys.has(column)) {
          continue;
        }
        const raw = value(column);
        if (!raw) {
          continue;
        }
        const field = fields.find((item) => item.key === column);
        attributes[column] = field?.fieldType === "number" ? Number(raw) : raw;
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

      parsed.push({
        row: rowNumber,
        sku,
        name,
        baseUnit,
        stockMin: Number(value("stock_minimo")) || 0,
        price: value("precio") ? Number(value("precio")) : null,
        cost: value("costo") ? Number(value("costo")) : null,
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
    const importable: ParsedRow[] = parsed.map((item) => ({
      ...item,
      existingId: idBySku.get(item.sku) ?? null,
    }));

    const created = importable.filter((item) => !item.existingId).length;
    const updated = importable.length - created;

    const report: ImportReport = {
      valid: importable.length,
      failed: errors.length,
      errors,
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
            attributes: item.attributes as Prisma.InputJsonValue,
          },
        });

        await tx.productPresentation.create({
          data: {
            tenantId: user.tenantId,
            productId: product.id,
            name: "Unidad",
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
