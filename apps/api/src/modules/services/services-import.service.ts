import { BadRequestException, Injectable, PayloadTooLargeException } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { hasValidMoneyScale, MONEY_MAX } from "@sellpoint/shared";
import { I18nService } from "nestjs-i18n";
import { parseSpreadsheet, serializeSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";

// El orden lo dictó Carlos (2026-09-01): código, nombre, costo, precio de
// venta y al final los campos personalizados del catálogo de servicios.
const STANDARD_COLUMNS = ["codigo", "nombre", "costo", "precio"] as const;

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const SERVICES_CATALOG_KEY = "services";

export interface ServiceImportRowError {
  row: number;
  field?: string;
  message: string;
  translated?: string;
  /** El código de la fila, para encontrarla en el Excel sin contar renglones. */
  itemCode?: string;
}

export interface ServiceImportReport {
  valid: number;
  failed: number;
  created: number;
  updated: number;
  errors: ServiceImportRowError[];
  applied: boolean;
}

interface LookupIndex {
  codeById: Map<string, string>;
  idByCode: Map<string, string>;
  idByLowerCode: Map<string, string>;
}

interface ParsedRow {
  row: number;
  code: string;
  name: string;
  cost: number | null;
  price: number | null;
  attributes: Record<string, unknown>;
  existingId: string | null;
}

/**
 * F2-IMPORT para SERVICIOS (Carlos, 2026-09-01) — solo Excel, y el match es
 * por `codigo`: la llave que el dueño ve en su pantalla.
 *
 * Espeja al importador de productos a propósito (mismo flujo dry-run →
 * aplicar, mismos errores por fila, misma resolución de subcatálogos por
 * CÓDIGO). La maquinaria de lookups está replicada de
 * `products/import.service.ts` en versión mínima: compartirla exigía
 * refactorizar el importador de F2 en caliente, y dos copias cortas con esta
 * nota son más baratas que ese riesgo.
 *
 * Un servicio NUEVO se ofrece en TODOS los almacenes activos: es el caso
 * común, y dejarlo sin almacén lo volvería invisible en el POS — un alta que
 * parece fallar. Al ACTUALIZAR no se tocan sus almacenes.
 */
@Injectable()
export class ServicesImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly i18n: I18nService,
  ) {}

  async template(user: AuthUser): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const { header, rows } = await this.catalogRows(user);
    const body =
      rows.length > 0
        ? rows
        : [["CONS-01", "Consulta general", "50", "250", ...header.slice(4).map(() => "")]];
    const file = await serializeSpreadsheet([header, ...body], "xlsx", {
      sheetName: "Servicios",
      filenameBase: "servicios",
    });
    return file;
  }

  async run(
    user: AuthUser,
    content: string,
    options: { dryRun: boolean; skipErrors: boolean; locale: Locale },
    meta: RequestMeta,
  ): Promise<ServiceImportReport> {
    const bytes = Buffer.from(content, "base64").byteLength;
    if (bytes > MAX_IMPORT_BYTES) {
      throw new PayloadTooLargeException({ message: "services.import_too_large" });
    }

    let rows: string[][];
    try {
      rows = await parseSpreadsheet(content, "xlsx");
    } catch {
      throw new BadRequestException({ message: "services.import_unreadable" });
    }
    if (rows.length < 2) {
      throw new BadRequestException({ message: "services.import_empty" });
    }

    const header = rows[0]?.map((cell) => cell.trim()) ?? [];
    const fields = await this.loadFields(user);
    const active = fields.filter((field) => !field.isArchived);
    const knownKeys = new Set(active.map((f) => f.key));
    const lookups = await this.loadLookupIndexes(user, active);

    const errors: ServiceImportRowError[] = [];
    const parsed: Omit<ParsedRow, "existingId">[] = [];
    const vistos = new Set<string>();

    for (let index = 1; index < rows.length; index += 1) {
      const rowNumber = index + 1;
      const cells = rows[index] ?? [];
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();

      const code = value("codigo");
      const name = value("nombre");
      // Todo error de esta fila lleva su código, si lo hay: es lo que permite
      // encontrarla en el Excel sin contar renglones (Carlos, 2026-09-01).
      const conCodigo = (error: ServiceImportRowError): ServiceImportRowError =>
        code ? { ...error, itemCode: code } : error;

      if (!code || !name) {
        errors.push(conCodigo({ row: rowNumber, message: "services.import_missing_required" }));
        continue;
      }
      if (vistos.has(code)) {
        errors.push(
          conCodigo({ row: rowNumber, field: "codigo", message: "services.import_duplicate_code" }),
        );
        continue;
      }
      vistos.add(code);

      const money: { costo: number | null; precio: number | null } = { costo: null, precio: null };
      let moneyError: ServiceImportRowError | null = null;
      for (const column of ["costo", "precio"] as const) {
        const raw = value(column);
        if (!raw) {
          continue;
        }
        const amount = Number(raw.replace(",", "."));
        if (
          !Number.isFinite(amount) ||
          amount < 0 ||
          amount > MONEY_MAX ||
          !hasValidMoneyScale(amount)
        ) {
          moneyError = { row: rowNumber, field: column, message: "services.import_invalid_money" };
          break;
        }
        money[column] = amount;
      }
      if (moneyError) {
        errors.push(conCodigo(moneyError));
        continue;
      }

      const attributes: Record<string, unknown> = {};
      let lookupError: ServiceImportRowError | null = null;
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
          const resolved =
            index.idByCode.get(raw) ?? index.idByLowerCode.get(raw.toLowerCase()) ?? null;
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
        const field = active.find((item) => item.key === column);
        attributes[column] = field?.fieldType === "number" ? Number(raw) : raw;
      }
      if (lookupError) {
        errors.push(conCodigo(lookupError));
        continue;
      }

      const attributeErrors = validateRecordAttributes(
        active.filter((field) => knownKeys.has(field.key)),
        attributes,
      );
      if (attributeErrors.length > 0) {
        errors.push(
          conCodigo({
            row: rowNumber,
            field: attributeErrors[0]?.key,
            message: attributeErrors[0]?.message ?? "services.import_invalid_attributes",
          }),
        );
        continue;
      }

      parsed.push({
        row: rowNumber,
        code,
        name,
        cost: money.costo,
        price: money.precio,
        attributes,
      });
    }

    const existing = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.service.findMany({
        where: { code: { in: parsed.map((item) => item.code) } },
        select: { id: true, code: true },
      }),
    );
    const idByCode = new Map(existing.map((service) => [service.code, service.id]));
    const importable: ParsedRow[] = parsed.map((item) => ({
      ...item,
      existingId: idByCode.get(item.code) ?? null,
    }));

    const created = importable.filter((item) => !item.existingId).length;
    const updated = importable.length - created;

    const report: ServiceImportReport = {
      valid: importable.length,
      failed: errors.length,
      created,
      updated,
      errors: errors.map((error) => ({
        ...error,
        translated: this.traducir(error.message, options.locale),
      })),
      applied: false,
    };

    if (options.dryRun) {
      return report;
    }
    if (errors.length > 0 && !options.skipErrors) {
      return report;
    }

    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const almacenes = await tx.warehouse.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      for (const item of importable) {
        if (item.existingId) {
          // El código no se toca: es la LLAVE por la que se reconoció la fila.
          await tx.service.update({
            where: { id: item.existingId },
            data: {
              name: item.name,
              ...(item.cost !== null ? { cost: item.cost } : {}),
              ...(item.price !== null ? { price: item.price } : {}),
              attributes: item.attributes as Prisma.InputJsonValue,
            },
          });
          continue;
        }
        const servicio = await tx.service.create({
          data: {
            tenantId: user.tenantId,
            code: item.code,
            name: item.name,
            cost: item.cost,
            price: item.price,
            attributes: item.attributes as Prisma.InputJsonValue,
          },
        });
        if (almacenes.length > 0) {
          await tx.serviceWarehouse.createMany({
            data: almacenes.map((almacen) => ({
              tenantId: user.tenantId,
              serviceId: servicio.id,
              warehouseId: almacen.id,
            })),
          });
        }
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "services.imported",
        resourceType: "service",
        after: { created, updated, failed: errors.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return { ...report, applied: true };
  }

  /** El catálogo completo como filas — plantilla y export comparten columnas. */
  private async catalogRows(user: AuthUser): Promise<{ header: string[]; rows: string[][] }> {
    const fields = await this.loadFields(user);
    const active = fields.filter((field) => !field.isArchived);
    const custom = active.map((field) => field.key);
    const header = [...STANDARD_COLUMNS, ...custom];
    const lookups = await this.loadLookupIndexes(user, active);

    const services = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.service.findMany({ orderBy: { code: "asc" } }),
    );

    const rows = services.map((service) => {
      const attributes = (service.attributes ?? {}) as Record<string, unknown>;
      return [
        service.code,
        service.name,
        service.cost?.toString() ?? "",
        service.price?.toString() ?? "",
        ...custom.map((key) => {
          const value = attributes[key];
          if (value === undefined || value === null) {
            return "";
          }
          const index = lookups.get(key);
          if (!index) {
            return String(value);
          }
          return index.codeById.get(String(value)) ?? "";
        }),
      ];
    });

    return { header, rows };
  }

  private async loadFields(user: AuthUser): Promise<FieldDefinition[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await tx.catalog.findFirst({
        where: { tenantId: user.tenantId, systemKey: SERVICES_CATALOG_KEY },
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
        orderBy: [{ position: "asc" }, { label: "asc" }],
      });
    });
  }

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
      const lower = record.code.toLowerCase();
      // Ambigüedad en minúsculas: mejor no adivinar.
      index.idByLowerCode.set(lower, index.idByLowerCode.has(lower) ? "" : record.id);
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

  private traducir(key: string, locale: Locale): string {
    const translated = this.i18n.translate(key, { lang: locale });
    return typeof translated === "string" ? translated : key;
  }
}
