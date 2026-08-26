import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { assertValidAttributes, loadCatalogFields } from "./attribute-assertions";
import type { CreateRecordDto, UpdateRecordDto } from "./dto/upsert-record.dto";
import { type FieldDefinition, validateRecordAttributes } from "./validate-attributes";

export interface CatalogRecordSummary {
  id: string;
  catalogId: string;
  code: string;
  attributes: unknown;
  isActive: boolean;
}

/** Opción lista para un picker de lookup (F2-CAT-06). */
export interface LookupOption {
  id: string;
  code: string;
  display: string;
}

/**
 * F2-CAT-05/06 — filas de los SUBCATÁLOGOS.
 *
 * Los productos NO pasan por acá: viven en su propia tabla porque F3/F4/F5 les
 * cuelgan FKs duras. Lo que comparten es el motor de campos y este validador.
 *
 * ── Integridad de los lookups ───────────────────────────────────────────
 * La DB no puede garantizarla: el destino de un lookup es un UUID DENTRO de un
 * JSONB, y Postgres no pone FKs ahí. Así que vive acá, en dos direcciones:
 *
 * - **Al escribir**: el registro apuntado tiene que existir, estar activo y
 *   pertenecer al catálogo que el campo declara como destino. Sin esto, el
 *   picker mostraría vacío en runtime sin explicación.
 * - **Al archivar**: si alguien lo referencia, 409 con quién. Es la query
 *   inversa (`attributes @> {...}`), la que justifica el índice GIN.
 */
@Injectable()
export class CatalogRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * La paginación (2026-08-25): antes traía el subcatálogo ENTERO. El picker
   * de lookups es OTRO método (`options`, con búsqueda y su propio tope): un
   * select necesita opciones filtrables, no páginas.
   */
  async list(
    user: AuthUser,
    catalogId: string,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<{ rows: CatalogRecordSummary[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, pagination?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, pagination?.pageSize ?? 20));

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findCatalogOrFail(tx, user, catalogId);
      const where = { catalogId };
      const [total, rows] = await Promise.all([
        tx.catalogRecord.count({ where }),
        tx.catalogRecord.findMany({
          where,
          // `code` es único por catálogo: ordena sin necesitar desempate.
          orderBy: { code: "asc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { rows, total, page, pageSize };
    });
  }

  /**
   * F2-CAT-06 — opciones para el picker de un campo lookup.
   *
   * `display` es el primer campo de texto activo del catálogo destino, o el
   * propio código si no hay ninguno: un picker que solo muestre `kg` obliga a
   * saberse los códigos de memoria; mostrar `kg — kilogramos` no.
   */
  async options(user: AuthUser, catalogId: string, query?: string): Promise<LookupOption[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findCatalogOrFail(tx, user, catalogId);

      const displayField = await tx.catalogField.findFirst({
        where: { catalogId, fieldType: "text", isArchived: false },
        orderBy: [{ position: "asc" }, { label: "asc" }],
        select: { key: true },
      });

      const records = await tx.catalogRecord.findMany({
        where: { catalogId, isActive: true },
        orderBy: { code: "asc" },
        take: 50,
      });

      const options = records.map((record) => {
        const attributes = (record.attributes ?? {}) as Record<string, unknown>;
        const raw = displayField ? attributes[displayField.key] : undefined;
        return {
          id: record.id,
          code: record.code,
          display: typeof raw === "string" && raw.trim() ? raw : record.code,
        };
      });

      if (!query?.trim()) {
        return options;
      }

      // Filtro en memoria sobre un tope de 50: un subcatálogo es una lista
      // corta (unidades, laboratorios, proveedores), no un catálogo de
      // productos. Cuando duela, se mueve al server como en F2-PROD-02.
      const needle = query.trim().toLowerCase();
      return options.filter(
        (option) =>
          option.code.toLowerCase().includes(needle) ||
          option.display.toLowerCase().includes(needle),
      );
    });
  }

  async create(
    user: AuthUser,
    catalogId: string,
    input: CreateRecordDto,
    meta: RequestMeta,
  ): Promise<CatalogRecordSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findCatalogOrFail(tx, user, catalogId);
      const fields = await this.loadFields(tx, catalogId);

      await this.assertAttributesValid(tx, user, fields, input.attributes);

      try {
        const record = await tx.catalogRecord.create({
          data: {
            tenantId: user.tenantId,
            catalogId,
            code: input.code,
            attributes: input.attributes as Prisma.InputJsonValue,
          },
        });

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "catalogs.record_create",
          resourceType: "catalog_record",
          resourceId: record.id,
          after: { catalogId, code: record.code },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return record;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "catalogs.record_code_taken" });
        }
        throw error;
      }
    });
  }

  async update(
    user: AuthUser,
    catalogId: string,
    recordId: string,
    input: UpdateRecordDto,
    meta: RequestMeta,
  ): Promise<CatalogRecordSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findCatalogOrFail(tx, user, catalogId);
      const current = await tx.catalogRecord.findFirst({
        where: { id: recordId, catalogId, tenantId: user.tenantId },
      });

      if (!current) {
        throw new NotFoundException({ message: "catalogs.record_not_found" });
      }

      if (input.attributes !== undefined) {
        const fields = await this.loadFields(tx, catalogId);
        await this.assertAttributesValid(tx, user, fields, input.attributes);
      }

      // Archivar un registro referenciado dejaría lookups apuntando a algo
      // que el picker ya no ofrece — se bloquea con el detalle de quién lo usa.
      if (input.isActive === false && current.isActive) {
        await this.assertNotReferenced(tx, catalogId, recordId);
      }

      try {
        const updated = await tx.catalogRecord.update({
          where: { id: recordId },
          data: {
            ...(input.code !== undefined ? { code: input.code } : {}),
            ...(input.attributes !== undefined
              ? { attributes: input.attributes as Prisma.InputJsonValue }
              : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          },
        });

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "catalogs.record_update",
          resourceType: "catalog_record",
          resourceId: recordId,
          before: { code: current.code, isActive: current.isActive },
          after: { code: updated.code, isActive: updated.isActive },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return updated;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException({ message: "catalogs.record_code_taken" });
        }
        throw error;
      }
    });
  }

  /**
   * Eliminar de verdad (Carlos, 2026-08-25). El MISMO guard que archivar
   * (`assertNotReferenced`): un registro al que alguien apunta por lookup no
   * se borra — primero hay que soltar la referencia. Uno libre sí se borra:
   * un typo en un subcatálogo no merece quedarse eternamente como "inactivo".
   */
  async remove(user: AuthUser, catalogId: string, recordId: string, meta: RequestMeta) {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findCatalogOrFail(tx, user, catalogId);

      const current = await tx.catalogRecord.findFirst({
        where: { id: recordId, catalogId, tenantId: user.tenantId },
      });
      if (!current) {
        throw new NotFoundException({ message: "catalogs.record_not_found" });
      }

      await this.assertNotReferenced(tx, catalogId, recordId);

      await tx.catalogRecord.delete({ where: { id: recordId } });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "catalogs.record_delete",
        resourceType: "catalog_record",
        resourceId: recordId,
        before: { code: current.code, isActive: current.isActive },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  private async loadFields(
    tx: Prisma.TransactionClient,
    catalogId: string,
  ): Promise<FieldDefinition[]> {
    return loadCatalogFields(tx, catalogId);
  }

  private async assertAttributesValid(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    fields: FieldDefinition[],
    attributes: Record<string, unknown>,
  ): Promise<void> {
    // Delegado al helper compartido del motor (2026-08-26).
    await assertValidAttributes(tx, user, fields, attributes, "catalogs.invalid_attributes");
  }

  /**
   * ¿Alguien apunta a este registro por lookup? Query INVERSA sobre el JSONB
   * de los registros de otros catálogos Y de las tres tablas de primera clase
   * (products, warehouses, services — 2026-08-26) — es la que hace que los
   * índices GIN valgan la pena. Olvidar una tabla dejaría borrar un registro
   * con la referencia colgada dentro del JSONB de esa entidad.
   */
  private async assertNotReferenced(
    tx: Prisma.TransactionClient,
    catalogId: string,
    recordId: string,
  ): Promise<void> {
    const referencingFields = await tx.catalogField.findMany({
      where: { lookupCatalogId: catalogId, isArchived: false },
      select: { key: true, catalogId: true, label: true },
    });

    for (const field of referencingFields) {
      const attributeFilter = { attributes: { path: [field.key], equals: recordId } };
      const counts = await Promise.all([
        tx.catalogRecord.count({
          where: { catalogId: field.catalogId, ...attributeFilter },
        }),
        tx.product.count({ where: attributeFilter }),
        tx.warehouse.count({ where: attributeFilter }),
        tx.service.count({ where: attributeFilter }),
      ]);

      const total = counts.reduce((sum, count) => sum + count, 0);
      if (total > 0) {
        throw new ConflictException({
          message: "catalogs.record_referenced",
          referencedBy: { fieldLabel: field.label, count: total },
        });
      }
    }
  }

  private async findCatalogOrFail(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    catalogId: string,
  ): Promise<{ id: string }> {
    const catalog = await tx.catalog.findFirst({
      where: { id: catalogId, tenantId: user.tenantId },
      select: { id: true },
    });

    if (!catalog) {
      throw new NotFoundException({ message: "catalogs.not_found" });
    }

    return catalog;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
