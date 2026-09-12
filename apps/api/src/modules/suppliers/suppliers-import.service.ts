import { Injectable } from "@nestjs/common";
import { isE164, isTaxId, type Locale, normalizeCode, normalizeTaxId } from "@sellpoint/shared";
import { I18nService } from "nestjs-i18n";
import { spreadsheetFilenameBase } from "../../common/spreadsheet/filenames";
import { localizeHeaders } from "../../common/spreadsheet/import-headers";
import { serializeSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import {
  customCells,
  customHeaderLabels,
  type ImportRowError,
  type LookupIndex,
  loadImportFields,
  loadLookupIndexes,
  parseCustomAttributes,
  readImportWorkbook,
  resolveCustomColumns,
  translateImportErrors,
} from "../catalogs/import-engine";
import { type FieldDefinition, validateRecordAttributes } from "../catalogs/validate-attributes";
import { SUPPLIERS_CATALOG_KEY } from "../tenants/role-catalog";

// El mismo orden que la ficha: código, nombre, registro fiscal, contacto,
// teléfono, email, dirección, notas — y al final los campos propios del
// catálogo de proveedores.
const STANDARD_COLUMNS = [
  "codigo",
  "nombre",
  "registro_fiscal",
  "contacto",
  "telefono",
  "email",
  "direccion",
  "notas",
] as const;

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** El mismo criterio laxo del DTO: algo@algo.tld. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface SupplierImportReport {
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
  taxId: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  attributes: Record<string, unknown>;
  existingId: string | null;
}

/**
 * Importar PROVEEDORES por planilla (Carlos, 2026-09-12: «que también se
 * pueda importar desde una plantilla Excel como en otros catálogos») — el
 * mismo flujo de almacenes: dry-run que reporta fila por fila y recién
 * después aplicar. El match es por `codigo`, la llave que el dueño ve en
 * pantalla (F9-SUPPCAT-03); una fila SIN código es un alta nueva a la que el
 * sistema le pone el siguiente `PROV-NNN`, igual que en el formulario.
 *
 * Lo común vive en `catalogs/import-engine`; acá queda lo que es SOLO de
 * proveedores: sus columnas y las validaciones de la ficha, que son las
 * MISMAS del DTO y del service — el registro fiscal se normaliza y valida
 * contra el país del negocio, el teléfono es E.164, el email tiene forma de
 * email. Una planilla no puede colar lo que el formulario rechazaría.
 *
 * Un proveedor que se actualiza conserva su `isActive`: la planilla edita
 * datos, no decide quién sigue activo.
 */
@Injectable()
export class SuppliersImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly i18n: I18nService,
  ) {}

  async template(
    user: AuthUser,
    locale: Locale = "es",
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const { header, rows } = await this.catalogRows(user);
    const body =
      rows.length > 0
        ? rows
        : [
            [
              "PROV-001",
              "Distribuidora Norte",
              "",
              "Rosa Luna",
              "+525512345678",
              "ventas@norte.mx",
              "Av. Norte 100, Ciudad de México",
              "",
              ...header.slice(STANDARD_COLUMNS.length).map(() => ""),
            ],
          ];
    return serializeSpreadsheet([localizeHeaders(header, locale), ...body], "xlsx", {
      sheetName: "Proveedores",
      filenameBase: spreadsheetFilenameBase("proveedores", locale),
    });
  }

  async run(
    user: AuthUser,
    content: string,
    options: { dryRun: boolean; skipErrors: boolean; locale: Locale },
    meta: RequestMeta,
  ): Promise<SupplierImportReport> {
    const { header: encabezado, rows } = await readImportWorkbook(content, {
      maxBytes: MAX_IMPORT_BYTES,
      messages: {
        tooLarge: "suppliers.import_too_large",
        unreadable: "suppliers.import_unreadable",
        empty: "suppliers.import_empty",
      },
    });

    const { fields, lookups } = await this.contexto(user);
    const { header, nameOf } = resolveCustomColumns(encabezado, fields);

    // El registro fiscal se valida contra el país del NEGOCIO (molde del
    // service); se consulta una vez, no por fila.
    const { country } = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId }, select: { country: true } }),
    );

    const errors: ImportRowError[] = [];
    const parsed: Omit<ParsedRow, "existingId">[] = [];
    const vistos = new Set<string>();

    rows.forEach((cells, index) => {
      // +2: la fila 1 es el encabezado y Excel cuenta desde 1.
      const rowNumber = index + 2;
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();

      // F9-SUPPCAT-01: en MAYÚSCULAS antes de buscar el existente, o `abc` duplicaría a `ABC`.
      const code = normalizeCode(value("codigo"));
      const name = value("nombre");
      const conCodigo = (error: ImportRowError): ImportRowError =>
        code ? { ...error, itemCode: code } : error;

      // El nombre es lo único obligatorio: sin código es un alta que el
      // sistema numera (PROV-NNN), como en la ficha.
      if (!name) {
        errors.push(conCodigo({ row: rowNumber, message: "suppliers.import_missing_required" }));
        return;
      }
      if (code) {
        if (vistos.has(code)) {
          errors.push(
            conCodigo({
              row: rowNumber,
              field: "codigo",
              message: "suppliers.import_duplicate_code",
            }),
          );
          return;
        }
        vistos.add(code);
      }

      const taxIdRaw = value("registro_fiscal");
      const taxId = taxIdRaw ? normalizeTaxId(country, taxIdRaw) : null;
      if (taxId !== null && !isTaxId(country, taxId)) {
        errors.push(
          conCodigo({
            row: rowNumber,
            field: "registro_fiscal",
            message: "suppliers.invalid_tax_id",
          }),
        );
        return;
      }
      const phone = value("telefono") || null;
      if (phone !== null && !isE164(phone)) {
        errors.push(
          conCodigo({ row: rowNumber, field: "telefono", message: "suppliers.invalid_phone" }),
        );
        return;
      }
      const email = value("email") || null;
      if (email !== null && !EMAIL_PATTERN.test(email)) {
        errors.push(
          conCodigo({ row: rowNumber, field: "email", message: "suppliers.invalid_email" }),
        );
        return;
      }

      const { attributes, lookupError } = parseCustomAttributes(header, value, fields, lookups);
      if (lookupError !== null) {
        errors.push(
          conCodigo({
            row: rowNumber,
            field: nameOf(lookupError),
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
            field: nameOf(attributeErrors[0]?.key ?? ""),
            message: attributeErrors[0]?.message ?? "suppliers.invalid_attributes",
          }),
        );
        return;
      }

      parsed.push({
        row: rowNumber,
        code,
        name,
        taxId,
        contactName: value("contacto") || null,
        phone,
        email,
        address: value("direccion") || null,
        notes: value("notas") || null,
        attributes,
      });
    });

    const conCodigo = parsed.filter((item) => item.code !== "");
    const existing = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.supplier.findMany({
        where: { code: { in: conCodigo.map((item) => item.code) } },
        select: { id: true, code: true },
      }),
    );
    const idByCode = new Map(existing.map((supplier) => [supplier.code, supplier.id]));
    const importable: ParsedRow[] = parsed.map((item) => ({
      ...item,
      existingId: item.code ? (idByCode.get(item.code) ?? null) : null,
    }));

    const created = importable.filter((item) => !item.existingId).length;
    const updated = importable.length - created;

    const report: SupplierImportReport = {
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
      // La serie PROV-NNN se calcula UNA vez y avanza en memoria: N altas sin
      // código en una misma planilla no pueden pelear por el mismo número.
      let siguiente = await this.siguienteDeLaSerie(tx, user.tenantId);
      for (const item of importable) {
        const datos = {
          name: item.name,
          taxId: item.taxId,
          contactName: item.contactName,
          phone: item.phone,
          email: item.email,
          address: item.address,
          notes: item.notes,
          attributes: item.attributes as Prisma.InputJsonValue,
          updatedBy: user.userId,
        };
        if (item.existingId) {
          // El código no se toca: es la LLAVE por la que se reconoció la fila.
          await tx.supplier.update({ where: { id: item.existingId }, data: datos });
          continue;
        }
        const code = item.code || `PROV-${String(siguiente++).padStart(3, "0")}`;
        await tx.supplier.create({
          data: { tenantId: user.tenantId, code, createdBy: user.userId, ...datos },
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "suppliers.imported",
        resourceType: "supplier",
        after: { created, updated, failed: errors.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return { ...report, applied: true };
  }

  /** El siguiente número de la serie `PROV-NNN` (MAX + 1, molde de `SuppliersService#nextCode`). */
  private async siguienteDeLaSerie(
    tx: Prisma.TransactionClient,
    tenantId: string,
  ): Promise<number> {
    const [fila] = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(substring(code FROM '^PROV-(\\d+)$')::int) AS max
        FROM suppliers
       WHERE tenant_id = ${tenantId}::uuid
         AND code ~ '^PROV-\\d+$'`;
    return (fila?.max ?? 0) + 1;
  }

  /** El catálogo completo como filas — la plantilla ES el catálogo actual. */
  private async catalogRows(user: AuthUser): Promise<{ header: string[]; rows: string[][] }> {
    const { fields, lookups } = await this.contexto(user);
    const custom = fields.map((field) => field.key);
    // El encabezado lleva la ETIQUETA de hoy; `custom` sigue siendo la key,
    // que es de dónde se leen los datos (Carlos, 2026-09-12).
    const header = [...STANDARD_COLUMNS, ...customHeaderLabels(fields)];

    const suppliers = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.supplier.findMany({ orderBy: { code: "asc" } }),
    );

    const rows = suppliers.map((supplier) => [
      supplier.code,
      supplier.name,
      supplier.taxId ?? "",
      supplier.contactName ?? "",
      supplier.phone ?? "",
      supplier.email ?? "",
      supplier.address ?? "",
      supplier.notes ?? "",
      ...customCells((supplier.attributes ?? {}) as Record<string, unknown>, custom, lookups),
    ]);

    return { header, rows };
  }

  private async contexto(
    user: AuthUser,
  ): Promise<{ fields: FieldDefinition[]; lookups: Map<string, LookupIndex> }> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await tx.catalog.findFirst({
        where: { tenantId: user.tenantId, systemKey: SUPPLIERS_CATALOG_KEY },
        select: { id: true },
      });
      const fields = catalog ? await loadImportFields(tx, catalog.id) : [];
      return { fields, lookups: await loadLookupIndexes(tx, fields) };
    });
  }
}
