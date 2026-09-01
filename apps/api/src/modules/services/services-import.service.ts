import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { hasValidMoneyScale, MONEY_MAX } from "@sellpoint/shared";
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

// El orden lo dictó Carlos (2026-09-01): código, nombre, costo, precio de
// venta y al final los campos personalizados del catálogo de servicios.
const STANDARD_COLUMNS = ["codigo", "nombre", "costo", "precio"] as const;

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const SERVICES_CATALOG_KEY = "services";

export type ServiceImportRowError = ImportRowError;

export interface ServiceImportReport {
  valid: number;
  failed: number;
  created: number;
  updated: number;
  errors: ServiceImportRowError[];
  applied: boolean;
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
 * La maquinaria común (leer la planilla, campos personalizados, lookups por
 * código, traducción de errores) vive en `catalogs/import-engine`; acá queda
 * lo que es SOLO de servicios: sus cuatro columnas estándar, la validación
 * del dinero y a qué almacenes se ofrece un servicio nuevo.
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
    return serializeSpreadsheet([header, ...body], "xlsx", {
      sheetName: "Servicios",
      filenameBase: "servicios",
    });
  }

  async run(
    user: AuthUser,
    content: string,
    options: { dryRun: boolean; skipErrors: boolean; locale: Locale },
    meta: RequestMeta,
  ): Promise<ServiceImportReport> {
    const { header, rows } = await readImportWorkbook(content, {
      maxBytes: MAX_IMPORT_BYTES,
      messages: {
        tooLarge: "services.import_too_large",
        unreadable: "services.import_unreadable",
        empty: "services.import_empty",
      },
    });

    const { fields, lookups } = await this.contexto(user);

    const errors: ServiceImportRowError[] = [];
    const parsed: Omit<ParsedRow, "existingId">[] = [];
    const vistos = new Set<string>();

    rows.forEach((cells, index) => {
      // +2: la fila 1 es el encabezado y Excel cuenta desde 1.
      const rowNumber = index + 2;
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();

      const code = value("codigo");
      const name = value("nombre");
      // Todo error de esta fila lleva su código, si lo hay: es lo que permite
      // encontrarla en el Excel sin contar renglones (Carlos, 2026-09-01).
      const conCodigo = (error: ServiceImportRowError): ServiceImportRowError =>
        code ? { ...error, itemCode: code } : error;

      if (!code || !name) {
        errors.push(conCodigo({ row: rowNumber, message: "services.import_missing_required" }));
        return;
      }
      if (vistos.has(code)) {
        errors.push(
          conCodigo({ row: rowNumber, field: "codigo", message: "services.import_duplicate_code" }),
        );
        return;
      }
      vistos.add(code);

      const money: { costo: number | null; precio: number | null } = { costo: null, precio: null };
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
          errors.push(
            conCodigo({ row: rowNumber, field: column, message: "services.import_invalid_money" }),
          );
          return;
        }
        money[column] = amount;
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
            message: attributeErrors[0]?.message ?? "services.import_invalid_attributes",
          }),
        );
        return;
      }

      parsed.push({
        row: rowNumber,
        code,
        name,
        cost: money.costo,
        price: money.precio,
        attributes,
      });
    });

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
      errors: translateImportErrors(this.i18n, errors, options.locale),
      applied: false,
    };

    if (options.dryRun || (errors.length > 0 && !options.skipErrors)) {
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
    const { fields, lookups } = await this.contexto(user);
    const custom = fields.map((field) => field.key);
    const header = [...STANDARD_COLUMNS, ...custom];

    const services = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.service.findMany({ orderBy: { code: "asc" } }),
    );

    const rows = services.map((service) => [
      service.code,
      service.name,
      service.cost?.toString() ?? "",
      service.price?.toString() ?? "",
      ...customCells((service.attributes ?? {}) as Record<string, unknown>, custom, lookups),
    ]);

    return { header, rows };
  }

  /** Los campos vigentes del catálogo de servicios y sus índices de lookup. */
  private async contexto(
    user: AuthUser,
  ): Promise<{ fields: FieldDefinition[]; lookups: Map<string, LookupIndex> }> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await tx.catalog.findFirst({
        where: { tenantId: user.tenantId, systemKey: SERVICES_CATALOG_KEY },
        select: { id: true },
      });
      const fields = catalog ? await loadImportFields(tx, catalog.id) : [];
      return { fields, lookups: await loadLookupIndexes(tx, fields) };
    });
  }
}
