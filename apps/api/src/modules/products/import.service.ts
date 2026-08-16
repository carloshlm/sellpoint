import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import { getUnit } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";
import { PRODUCTS_CATALOG_KEY } from "../tenants/role-catalog";
import { parseCsv, toCsv } from "./csv";
import { derivesFractionalInput } from "./products.service";

/** 5 MB: por encima de eso la importación necesita ser asíncrona (diferido). */
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
  imported: number;
}

/**
 * F2-IMPORT-01/02/03 — plantilla, validación previa e importación.
 *
 * El flujo es SIEMPRE en dos pasos: primero un dry-run que devuelve el reporte
 * fila por fila, después la importación real. Que el usuario vea qué va a
 * pasar antes de que pase es la diferencia entre "importé 245 productos" y
 * "importé 245 productos y ahora no sé cuáles quedaron mal".
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * F2-IMPORT-01. La plantilla se genera con los campos VIGENTES del catálogo
   * de productos: agregar un campo hoy y descargar la plantilla mañana trae la
   * columna nueva, sin que nadie mantenga una lista aparte.
   */
  async template(user: AuthUser): Promise<string> {
    const fields = await this.loadFields(user);
    const custom = fields.filter((field) => !field.isArchived).map((field) => field.key);

    return toCsv([
      [...STANDARD_COLUMNS, ...custom],
      // Fila de ejemplo: sin ella, nadie sabe si "precio" va con punto o coma.
      ["PAR-500", "Paracetamol 500mg", "unit", "0", "15.50", "9.00", ...custom.map(() => "")],
    ]);
  }

  async run(
    user: AuthUser,
    content: string,
    options: { dryRun: boolean; skipErrors: boolean },
    meta: RequestMeta,
  ): Promise<ImportReport> {
    if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) {
      // Diferido a propósito: procesar asíncrono exige un sistema de
      // notificaciones que todavía no existe (IMPLEMENTACION.md, F2).
      throw new PayloadTooLargeException({ message: "products.import_too_large" });
    }

    const rows = parseCsv(content);
    if (rows.length < 2) {
      throw new BadRequestException({ message: "products.import_empty" });
    }

    const header = rows[0]?.map((cell) => cell.trim()) ?? [];
    const fields = await this.loadFields(user);
    const knownKeys = new Set(fields.filter((field) => !field.isArchived).map((f) => f.key));

    const errors: ImportRowError[] = [];
    const parsed: {
      row: number;
      sku: string;
      name: string;
      baseUnit: string;
      stockMin: number;
      price: number | null;
      cost: number | null;
      attributes: Record<string, unknown>;
    }[] = [];

    const seenSkus = new Set<string>();

    for (let index = 1; index < rows.length; index += 1) {
      // +1 porque la fila 1 es el encabezado: el número que se reporta es el
      // que el usuario ve en Excel.
      const rowNumber = index + 1;
      const cells = rows[index] ?? [];
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();

      const sku = value("sku");
      const name = value("nombre");

      if (!sku || !name) {
        errors.push({ row: rowNumber, message: "products.import_missing_required" });
        continue;
      }

      // Duplicado DENTRO del archivo: la DB no lo vería hasta el segundo
      // INSERT, y para entonces el primero ya entró.
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

    // SKUs que ya existen en la DB: se detectan ANTES de intentar insertar
    // para que el reporte los muestre junto al resto.
    const existing = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.product.findMany({
        where: { sku: { in: parsed.map((item) => item.sku) } },
        select: { sku: true },
      }),
    );
    const existingSkus = new Set(existing.map((product) => product.sku));
    const importable = parsed.filter((item) => {
      if (existingSkus.has(item.sku)) {
        errors.push({ row: item.row, field: "sku", message: "products.sku_taken" });
        return false;
      }
      return true;
    });

    const report: ImportReport = {
      valid: importable.length,
      failed: errors.length,
      errors,
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
        after: { imported: importable.length, failed: errors.length },
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
