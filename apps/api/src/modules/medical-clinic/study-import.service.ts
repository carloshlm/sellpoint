import { Injectable } from "@nestjs/common";
import type { Locale } from "@sellpoint/shared";
import { hasValidMoneyScale, MONEY_MAX } from "@sellpoint/shared";
import { I18nService } from "nestjs-i18n";
import { localizeHeaders } from "../../common/spreadsheet/import-headers";
import { serializeSpreadsheet } from "../../common/spreadsheet/spreadsheet";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import {
  type ImportRowError,
  readImportWorkbook,
  translateImportErrors,
} from "../catalogs/import-engine";

/**
 * Las columnas, en el orden en que el dueño las lee. Sin campos
 * personalizados: el catálogo de estudios no pasa por el motor de catálogos
 * —es del módulo, no del negocio genérico—, así que la plantilla es fija.
 */
const COLUMNAS = ["codigo", "nombre", "descripcion", "costo", "precio"] as const;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export interface StudyImportReport {
  valid: number;
  failed: number;
  created: number;
  updated: number;
  errors: ImportRowError[];
  applied: boolean;
}

interface FilaLeida {
  row: number;
  code: string;
  name: string;
  description: string | null;
  cost: number | null;
  price: number | null;
  existingId: string | null;
}

/** Lo mínimo que el importador necesita de los dos delegates. */
interface ImportDelegate {
  findMany(args: {
    where?: Record<string, unknown>;
    orderBy?: { code: "asc" };
    select?: Record<string, boolean>;
  }): Promise<
    {
      id: string;
      code: string;
      name?: string;
      description?: string | null;
      cost?: { toString(): string } | null;
      price?: { toString(): string } | null;
    }[]
  >;
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
}

export interface StudyImportConfig {
  /** `lab_study` | `diagnostic_study`: acción de auditoría y nombre del archivo. */
  resource: string;
  sheetName: string;
  filenameBase: string;
  /** La fila de ejemplo cuando el catálogo está vacío. */
  ejemplo: string[];
  delegate(tx: Prisma.TransactionClient): ImportDelegate;
}

/**
 * F9-CLINIC — importar estudios desde Excel.
 *
 * Mismo molde que `services-import.service.ts` (Carlos, 2026-09-04: «que uses
 * la misma forma y estilos»): la plantilla trae lo ya dado de alta para
 * editarlo y resubirlo, el match es por CÓDIGO —la llave que el dueño ve—, y
 * una corrida en seco reporta sin escribir.
 *
 * Parametrizado por delegate como `StudyCatalogService`: laboratorio y
 * gabinete comparten forma hoy y pueden divergir mañana sin un `if kind`.
 */
export abstract class StudyImportService {
  protected abstract readonly config: StudyImportConfig;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly auditService: AuditService,
    protected readonly i18n: I18nService,
  ) {}

  async template(
    user: AuthUser,
    locale: Locale = "es",
  ): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const estudios = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      this.config.delegate(tx).findMany({ orderBy: { code: "asc" } }),
    );
    const filas = estudios.map((e) => [
      e.code,
      e.name ?? "",
      e.description ?? "",
      e.cost?.toString() ?? "",
      e.price?.toString() ?? "",
    ]);
    return await serializeSpreadsheet(
      [localizeHeaders(COLUMNAS, locale), ...(filas.length > 0 ? filas : [this.config.ejemplo])],
      "xlsx",
      { sheetName: this.config.sheetName, filenameBase: this.config.filenameBase },
    );
  }

  async run(
    user: AuthUser,
    content: string,
    options: { dryRun: boolean; skipErrors: boolean; locale: Locale },
    meta: RequestMeta,
  ): Promise<StudyImportReport> {
    const { header, rows } = await readImportWorkbook(content, {
      maxBytes: MAX_IMPORT_BYTES,
      messages: {
        tooLarge: "medical_clinic.import_too_large",
        unreadable: "medical_clinic.import_unreadable",
        empty: "medical_clinic.import_empty",
      },
    });

    const errors: ImportRowError[] = [];
    const leidas: Omit<FilaLeida, "existingId">[] = [];
    const vistos = new Set<string>();

    rows.forEach((cells, index) => {
      // +2: la fila 1 es el encabezado y Excel cuenta desde 1.
      const rowNumber = index + 2;
      const value = (column: string) => (cells[header.indexOf(column)] ?? "").trim();
      const code = value("codigo");
      const name = value("nombre");
      // Todo error lleva su código: es lo que permite encontrar la fila en el
      // Excel sin contar renglones.
      const conCodigo = (error: ImportRowError): ImportRowError =>
        code ? { ...error, itemCode: code } : error;

      if (!code || !name) {
        errors.push(
          conCodigo({ row: rowNumber, message: "medical_clinic.import_missing_required" }),
        );
        return;
      }
      if (vistos.has(code)) {
        errors.push(
          conCodigo({
            row: rowNumber,
            field: "codigo",
            message: "medical_clinic.import_duplicate_code",
          }),
        );
        return;
      }
      vistos.add(code);

      const dinero: { costo: number | null; precio: number | null } = { costo: null, precio: null };
      for (const column of ["costo", "precio"] as const) {
        const raw = value(column);
        if (!raw) {
          continue;
        }
        const monto = Number(raw.replace(",", "."));
        if (
          !Number.isFinite(monto) ||
          monto < 0 ||
          monto > MONEY_MAX ||
          !hasValidMoneyScale(monto)
        ) {
          errors.push(
            conCodigo({
              row: rowNumber,
              field: column,
              message: "medical_clinic.import_invalid_money",
            }),
          );
          return;
        }
        dinero[column] = monto;
      }

      leidas.push({
        row: rowNumber,
        code,
        name,
        description: value("descripcion") || null,
        cost: dinero.costo,
        price: dinero.precio,
      });
    });

    const existentes = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      this.config.delegate(tx).findMany({
        where: { code: { in: leidas.map((f) => f.code) } },
        select: { id: true, code: true },
      }),
    );
    const idPorCodigo = new Map(existentes.map((e) => [e.code, e.id]));
    const importables: FilaLeida[] = leidas.map((f) => ({
      ...f,
      existingId: idPorCodigo.get(f.code) ?? null,
    }));

    const created = importables.filter((f) => !f.existingId).length;
    const updated = importables.length - created;
    const report: StudyImportReport = {
      valid: importables.length,
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
      const modelo = this.config.delegate(tx);
      for (const fila of importables) {
        // El código NO se toca: es la llave por la que se reconoció la fila.
        const datos = {
          name: fila.name,
          description: fila.description,
          ...(fila.cost !== null ? { cost: fila.cost } : {}),
          ...(fila.price !== null ? { price: fila.price } : {}),
        };
        if (fila.existingId) {
          await modelo.update({ where: { id: fila.existingId }, data: datos });
          continue;
        }
        await modelo.create({
          data: {
            tenantId: user.tenantId,
            code: fila.code,
            cost: fila.cost,
            price: fila.price,
            createdBy: user.userId,
            ...datos,
          },
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: `medical_clinic.${this.config.resource}.imported`,
        resourceType: this.config.resource,
        after: { created, updated, failed: errors.length },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    return { ...report, applied: true };
  }
}

@Injectable()
export class LabStudyImportService extends StudyImportService {
  protected readonly config: StudyImportConfig = {
    resource: "lab_study",
    sheetName: "Estudios de laboratorio",
    filenameBase: "estudios-laboratorio",
    ejemplo: ["BH", "Biometría hemática", "", "120", "350"],
    delegate: (tx) => tx.medicalClinicLabStudy as unknown as ImportDelegate,
  };

  // El constructor explícito NO es ceremonia: sin él, Nest no ve los
  // `design:paramtypes` del padre en la subclase decorada y las dependencias
  // llegan `undefined` (mismo motivo por el que `LabStudiesService` lo
  // declara). Se paga con un 500 al primer uso, que ningún unit test ve
  // porque ahí la clase se construye a mano.
  constructor(prisma: PrismaService, auditService: AuditService, i18n: I18nService) {
    super(prisma, auditService, i18n);
  }
}

@Injectable()
export class DiagnosticStudyImportService extends StudyImportService {
  protected readonly config: StudyImportConfig = {
    resource: "diagnostic_study",
    sheetName: "Estudios diagnósticos",
    filenameBase: "estudios-diagnosticos",
    ejemplo: ["RXT", "Radiografía de tórax", "", "300", "650"],
    delegate: (tx) => tx.medicalClinicDiagnosticStudy as unknown as ImportDelegate,
  };

  // El constructor explícito NO es ceremonia: sin él, Nest no ve los
  // `design:paramtypes` del padre en la subclase decorada y las dependencias
  // llegan `undefined` (mismo motivo por el que `LabStudiesService` lo
  // declara). Se paga con un 500 al primer uso, que ningún unit test ve
  // porque ahí la clase se construye a mano.
  constructor(prisma: PrismaService, auditService: AuditService, i18n: I18nService) {
    super(prisma, auditService, i18n);
  }
}
