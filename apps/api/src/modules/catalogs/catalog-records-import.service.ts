import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { I18nService } from "nestjs-i18n";
import { localizeHeaders } from "../../common/spreadsheet/import-headers";
import { serializeSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import {
  customCells,
  type ImportRowError,
  type LookupIndex,
  loadImportFields,
  loadLookupIndexes,
  parseCustomAttributes,
  readImportWorkbook,
  translateImportErrors,
} from "./import-engine";
import { type FieldDefinition, validateRecordAttributes } from "./validate-attributes";

/** El único estándar de un registro de subcatálogo: su código. */
const STANDARD_COLUMNS = ["codigo"] as const;

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface RecordsImportReport {
  valid: number;
  failed: number;
  created: number;
  updated: number;
  errors: ImportRowError[];
  applied: boolean;
}

interface ParsedRow {
  row: number;
  code: string;
  attributes: Record<string, unknown>;
  existingId: string | null;
}

/**
 * Importar registros de un SUBCATÁLOGO por planilla (Carlos, 2026-09-01):
 * laboratorios, proveedores, unidades… cualquiera que el negocio haya
 * definido. Mismo flujo que productos, servicios y almacenes —dry-run por
 * fila, match por código— y el mismo motor (`import-engine`).
 *
 * Un subcatálogo no tiene columnas estándar más allá del código: TODO lo
 * demás son sus campos personalizados, así que la plantilla es «codigo» + lo
 * que el negocio definió en Campos, en ese orden.
 *
 * Los catálogos del SISTEMA (productos, servicios, almacenes) no pasan por
 * acá: sus filas viven en tablas de primera clase con sus propias reglas, y
 * cada uno tiene su importador. Aceptarlos «por si acaso» escribiría
 * `catalog_records` que nadie lee.
 */
@Injectable()
export class CatalogRecordsImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly i18n: I18nService,
  ) {}

  async template(
    user: AuthUser,
    catalogId: string,
    locale: Locale = "es",
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const { header, rows, catalogName } = await this.catalogRows(user, catalogId);
    const body = rows.length > 0 ? rows : [["EJEMPLO-01", ...header.slice(1).map(() => "")]];
    return serializeSpreadsheet([localizeHeaders(header, locale), ...body], "xlsx", {
      sheetName: catalogName.slice(0, 31),
      filenameBase: "registros",
    });
  }

  async run(
    user: AuthUser,
    catalogId: string,
    content: string,
    options: { dryRun: boolean; skipErrors: boolean; locale: Locale },
    meta: RequestMeta,
  ): Promise<RecordsImportReport> {
    const { header, rows } = await readImportWorkbook(content, {
      maxBytes: MAX_IMPORT_BYTES,
      messages: {
        tooLarge: "catalogs.import_too_large",
        unreadable: "catalogs.import_unreadable",
        empty: "catalogs.import_empty",
      },
    });

    const { fields, lookups } = await this.contexto(user, catalogId);

    const errors: ImportRowError[] = [];
    const parsed: Omit<ParsedRow, "existingId">[] = [];
    const vistos = new Set<string>();

    rows.forEach((cells, index) => {
      // +2: la fila 1 es el encabezado y Excel cuenta desde 1.
      const rowNumber = index + 2;
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();

      const code = value("codigo");
      const conCodigo = (error: ImportRowError): ImportRowError =>
        code ? { ...error, itemCode: code } : error;

      if (!code) {
        errors.push({
          row: rowNumber,
          field: "codigo",
          message: "catalogs.import_missing_required",
        });
        return;
      }
      if (vistos.has(code)) {
        errors.push(
          conCodigo({ row: rowNumber, field: "codigo", message: "catalogs.import_duplicate_code" }),
        );
        return;
      }
      vistos.add(code);

      const { attributes, lookupError } = parseCustomAttributes(header, value, fields, lookups);
      if (lookupError !== null) {
        errors.push(
          conCodigo({
            row: rowNumber,
            field: lookupError,
            message: "catalogs.lookup_value_not_found",
          }),
        );
        return;
      }
      const attributeErrors = validateRecordAttributes(fields, attributes);
      if (attributeErrors.length > 0) {
        errors.push(
          conCodigo({
            row: rowNumber,
            field: attributeErrors[0]?.key,
            message: attributeErrors[0]?.message ?? "catalogs.import_invalid_attributes",
          }),
        );
        return;
      }

      parsed.push({ row: rowNumber, code, attributes });
    });

    const existing = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.catalogRecord.findMany({
        where: { catalogId, code: { in: parsed.map((item) => item.code) } },
        select: { id: true, code: true },
      }),
    );
    const idByCode = new Map(existing.map((record) => [record.code, record.id]));
    const importable: ParsedRow[] = parsed.map((item) => ({
      ...item,
      existingId: idByCode.get(item.code) ?? null,
    }));

    const created = importable.filter((item) => !item.existingId).length;
    const updated = importable.length - created;

    const report: RecordsImportReport = {
      valid: importable.length,
      failed: errors.length,
      created,
      updated,
      errors: translateImportErrors(this.i18n, errors, options.locale),
      applied: false,
    };

    if (options.dryRun || (errors.length > 0 && !options.skipErrors)) {
      return report;
    }

    await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      for (const item of importable) {
        if (item.existingId) {
          // El código no se toca: es la LLAVE por la que se reconoció la fila.
          await tx.catalogRecord.update({
            where: { id: item.existingId },
            data: { attributes: item.attributes as Prisma.InputJsonValue },
          });
          continue;
        }
        await tx.catalogRecord.create({
          data: {
            tenantId: user.tenantId,
            catalogId,
            code: item.code,
            attributes: item.attributes as Prisma.InputJsonValue,
          },
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "catalogs.records_imported",
        resourceType: "catalog",
        resourceId: catalogId,
        after: { created, updated, failed: errors.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return { ...report, applied: true };
  }

  /** El subcatálogo completo como filas — la plantilla ES el catálogo actual. */
  private async catalogRows(
    user: AuthUser,
    catalogId: string,
  ): Promise<{ header: string[]; rows: string[][]; catalogName: string }> {
    const { fields, lookups, catalogName } = await this.contexto(user, catalogId);
    const custom = fields.map((field) => field.key);
    const header = [...STANDARD_COLUMNS, ...custom];

    const records = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.catalogRecord.findMany({ where: { catalogId }, orderBy: { code: "asc" } }),
    );

    const rows = records.map((record) => [
      record.code,
      ...customCells((record.attributes ?? {}) as Record<string, unknown>, custom, lookups),
    ]);

    return { header, rows, catalogName };
  }

  /**
   * El subcatálogo (del tenant, y NO de sistema), sus campos vigentes y sus
   * índices de lookup.
   */
  private async contexto(
    user: AuthUser,
    catalogId: string,
  ): Promise<{
    fields: FieldDefinition[];
    lookups: Map<string, LookupIndex>;
    catalogName: string;
  }> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await tx.catalog.findFirst({
        where: { id: catalogId, tenantId: user.tenantId },
        select: { id: true, name: true, isSystem: true },
      });
      if (catalog === null) {
        throw new NotFoundException({ message: "catalogs.not_found" });
      }
      if (catalog.isSystem) {
        throw new BadRequestException({ message: "catalogs.import_system_catalog" });
      }
      const fields = await loadImportFields(tx, catalog.id);
      return { fields, lookups: await loadLookupIndexes(tx, fields), catalogName: catalog.name };
    });
  }
}
