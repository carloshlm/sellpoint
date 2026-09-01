import { Injectable } from "@nestjs/common";
import { isE164, type Locale } from "@sellpoint/shared";
import { I18nService } from "nestjs-i18n";
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
} from "../catalogs/import-engine";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";
import { WAREHOUSES_CATALOG_KEY } from "../tenants/role-catalog";

// El mismo orden que el formulario: código, nombre, dirección, teléfono,
// email — y al final los campos personalizados del catálogo de almacenes.
const STANDARD_COLUMNS = ["codigo", "nombre", "direccion", "telefono", "email"] as const;

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** El mismo criterio laxo del DTO: algo@algo.tld. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface WarehouseImportReport {
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
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  attributes: Record<string, unknown>;
  existingId: string | null;
}

/**
 * Importar ALMACENES por planilla (Carlos, 2026-09-01) — el mismo flujo de
 * productos y servicios: dry-run que reporta fila por fila y recién después
 * aplicar. El match es por `codigo`, la llave que el dueño ve en pantalla.
 *
 * Lo común vive en `catalogs/import-engine`; acá queda lo que es SOLO de
 * almacenes: sus cinco columnas estándar y la validación del contacto
 * (teléfono E.164, email), que es la MISMA del DTO — una planilla no puede
 * colar un teléfono que el formulario rechazaría.
 *
 * Un almacén que se actualiza conserva su `isActive` y su alcance de usuarios:
 * la planilla edita datos, no decide quién opera dónde.
 */
@Injectable()
export class WarehousesImportService {
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
        : [
            [
              "ALM-002",
              "Sucursal Norte",
              "Av. Norte 100, CDMX",
              "+525512345678",
              "norte@negocio.mx",
              ...header.slice(5).map(() => ""),
            ],
          ];
    return serializeSpreadsheet([header, ...body], "xlsx", {
      sheetName: "Almacenes",
      filenameBase: "almacenes",
    });
  }

  async run(
    user: AuthUser,
    content: string,
    options: { dryRun: boolean; skipErrors: boolean; locale: Locale },
    meta: RequestMeta,
  ): Promise<WarehouseImportReport> {
    const { header, rows } = await readImportWorkbook(content, {
      maxBytes: MAX_IMPORT_BYTES,
      messages: {
        tooLarge: "warehouses.import_too_large",
        unreadable: "warehouses.import_unreadable",
        empty: "warehouses.import_empty",
      },
    });

    const { fields, lookups } = await this.contexto(user);

    const errors: ImportRowError[] = [];
    const parsed: Omit<ParsedRow, "existingId">[] = [];
    const vistos = new Set<string>();

    rows.forEach((cells, index) => {
      // +2: la fila 1 es el encabezado y Excel cuenta desde 1.
      const rowNumber = index + 2;
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();

      const code = value("codigo");
      const name = value("nombre");
      const conCodigo = (error: ImportRowError): ImportRowError =>
        code ? { ...error, itemCode: code } : error;

      if (!code || !name) {
        errors.push(conCodigo({ row: rowNumber, message: "warehouses.import_missing_required" }));
        return;
      }
      if (vistos.has(code)) {
        errors.push(
          conCodigo({
            row: rowNumber,
            field: "codigo",
            message: "warehouses.import_duplicate_code",
          }),
        );
        return;
      }
      vistos.add(code);

      const phone = value("telefono") || null;
      if (phone !== null && !isE164(phone)) {
        errors.push(
          conCodigo({ row: rowNumber, field: "telefono", message: "warehouses.invalid_phone" }),
        );
        return;
      }
      const email = value("email") || null;
      if (email !== null && !EMAIL_PATTERN.test(email)) {
        errors.push(
          conCodigo({ row: rowNumber, field: "email", message: "warehouses.invalid_email" }),
        );
        return;
      }

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
            message: attributeErrors[0]?.message ?? "warehouses.invalid_attributes",
          }),
        );
        return;
      }

      parsed.push({
        row: rowNumber,
        code,
        name,
        address: value("direccion") || null,
        phone,
        email,
        attributes,
      });
    });

    const existing = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.warehouse.findMany({
        where: { code: { in: parsed.map((item) => item.code) } },
        select: { id: true, code: true },
      }),
    );
    const idByCode = new Map(existing.map((warehouse) => [warehouse.code, warehouse.id]));
    const importable: ParsedRow[] = parsed.map((item) => ({
      ...item,
      existingId: idByCode.get(item.code) ?? null,
    }));

    const created = importable.filter((item) => !item.existingId).length;
    const updated = importable.length - created;

    const report: WarehouseImportReport = {
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
        const datos = {
          name: item.name,
          address: item.address,
          phone: item.phone,
          email: item.email,
          attributes: item.attributes as Prisma.InputJsonValue,
        };
        if (item.existingId) {
          // El código no se toca: es la LLAVE por la que se reconoció la fila.
          await tx.warehouse.update({ where: { id: item.existingId }, data: datos });
          continue;
        }
        await tx.warehouse.create({
          data: { tenantId: user.tenantId, code: item.code, ...datos },
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "warehouses.imported",
        resourceType: "warehouse",
        after: { created, updated, failed: errors.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return { ...report, applied: true };
  }

  /** El catálogo completo como filas — la plantilla ES el catálogo actual. */
  private async catalogRows(user: AuthUser): Promise<{ header: string[]; rows: string[][] }> {
    const { fields, lookups } = await this.contexto(user);
    const custom = fields.map((field) => field.key);
    const header = [...STANDARD_COLUMNS, ...custom];

    const warehouses = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.warehouse.findMany({ orderBy: { code: "asc" } }),
    );

    const rows = warehouses.map((warehouse) => [
      warehouse.code,
      warehouse.name,
      warehouse.address ?? "",
      warehouse.phone ?? "",
      warehouse.email ?? "",
      ...customCells((warehouse.attributes ?? {}) as Record<string, unknown>, custom, lookups),
    ]);

    return { header, rows };
  }

  private async contexto(
    user: AuthUser,
  ): Promise<{ fields: FieldDefinition[]; lookups: Map<string, LookupIndex> }> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await tx.catalog.findFirst({
        where: { tenantId: user.tenantId, systemKey: WAREHOUSES_CATALOG_KEY },
        select: { id: true },
      });
      const fields = catalog ? await loadImportFields(tx, catalog.id) : [];
      return { fields, lookups: await loadLookupIndexes(tx, fields) };
    });
  }
}
