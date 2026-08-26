import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { CreateFieldDto } from "./dto/create-field.dto";
import type { UpdateFieldDto } from "./dto/update-field.dto";
import { deriveFieldKey } from "./field-key";
import { systemAttributeTable } from "./system-catalogs";

export interface CatalogFieldSummary {
  id: string;
  catalogId: string;
  key: string;
  label: string;
  fieldType: "text" | "number" | "lookup";
  lookupCatalogId: string | null;
  required: boolean;
  position: number;
  isArchived: boolean;
}

/** Lo que el service devuelve cuando archivar necesita confirmación explícita. */
export interface FieldRemovalBlocked {
  requiresConfirmation: true;
  recordCount: number;
}

/**
 * F2-CAT-03 — campos personalizados de un catálogo, con las GUARDAS que
 * reemplazan al versionado (decisión de Carlos, 2026-08-16).
 *
 * Las tres guardas y por qué existen:
 *
 * 1. **Quitar un campo con datos** exige `confirm: true` y NO borra los
 *    valores: archiva el campo (`isArchived`) y los deja intactos dentro de
 *    `attributes`. Restaurarlo devuelve todo. Un DELETE real solo ocurre
 *    cuando ningún registro usa la key — ahí no hay nada que perder.
 * 2. **Cambiar el tipo con datos** se bloquea. No existe una respuesta
 *    automática correcta para convertir "aproximadamente 3" a número, y
 *    elegir una en silencio corrompe datos del cliente.
 * 3. **Un lookup apunta a un catálogo VIVO del tenant.** El CHECK de la DB
 *    garantiza que haya destino; que ese destino exista, esté activo y sea
 *    del mismo tenant es responsabilidad de acá.
 */
@Injectable()
export class CatalogFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(user: AuthUser, catalogId: string): Promise<CatalogFieldSummary[]> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findCatalogOrFail(tx, user, catalogId);
      return tx.catalogField.findMany({
        where: { catalogId },
        orderBy: [{ position: "asc" }, { label: "asc" }],
      });
    });
  }

  async create(
    user: AuthUser,
    catalogId: string,
    input: CreateFieldDto,
    meta: RequestMeta,
  ): Promise<CatalogFieldSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.findCatalogOrFail(tx, user, catalogId);

      if (input.lookupCatalogId) {
        await this.assertLookupTargetUsable(tx, user, input.lookupCatalogId);
      }

      const key = deriveFieldKey(input.label);

      // Se apenda al final. `position` es del usuario a partir de acá: el
      // editor lo reordena, el server no vuelve a opinar.
      const last = await tx.catalogField.findFirst({
        where: { catalogId },
        orderBy: { position: "desc" },
        select: { position: true },
      });

      try {
        const field = await tx.catalogField.create({
          data: {
            tenantId: user.tenantId,
            catalogId,
            key,
            label: input.label,
            fieldType: input.fieldType,
            lookupCatalogId: input.lookupCatalogId ?? null,
            required: input.required,
            position: (last?.position ?? -1) + 1,
          },
        });

        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "catalogs.field_create",
          resourceType: "catalog_field",
          resourceId: field.id,
          after: { catalogId, key, label: field.label, fieldType: field.fieldType },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        return field;
      } catch (error) {
        if (isUniqueViolation(error)) {
          // Dos etiquetas que un humano lee igual ("Color" y "COLOR") derivan
          // a la misma key: para el usuario ES el mismo campo repetido.
          throw new ConflictException({ message: "catalogs.field_key_taken" });
        }
        throw error;
      }
    });
  }

  async update(
    user: AuthUser,
    catalogId: string,
    fieldId: string,
    input: UpdateFieldDto,
    meta: RequestMeta,
  ): Promise<CatalogFieldSummary> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await this.findCatalogOrFail(tx, user, catalogId);
      const current = await tx.catalogField.findFirst({
        where: { id: fieldId, catalogId, tenantId: user.tenantId },
      });

      if (!current) {
        throw new NotFoundException({ message: "catalogs.field_not_found" });
      }

      const changesType = input.fieldType !== undefined && input.fieldType !== current.fieldType;

      if (changesType) {
        const recordCount = await this.countRecordsUsingKey(tx, catalog, current.key);
        if (recordCount > 0) {
          throw new ConflictException({
            message: "catalogs.field_type_locked_by_data",
            recordCount,
          });
        }
      }

      // Se valida el ESTADO RESULTANTE del campo, no el delta: un PATCH puede
      // tocar el tipo, el destino, los dos o ninguno, y lo único que importa
      // es que lo que quede cumpla el CHECK de la DB (lookup ⇔ destino). Mirar
      // solo los campos enviados llevaba a exigirle limpiar el destino a un
      // campo de texto que nunca tuvo uno.
      const resultingType = input.fieldType ?? current.fieldType;
      const resultingTarget =
        input.lookupCatalogId !== undefined ? input.lookupCatalogId : current.lookupCatalogId;

      if (resultingType === "lookup" && !resultingTarget) {
        throw new ConflictException({ message: "catalogs.lookup_target_required" });
      }
      if (resultingType !== "lookup" && resultingTarget) {
        throw new ConflictException({ message: "catalogs.lookup_target_not_allowed" });
      }
      if (resultingTarget) {
        await this.assertLookupTargetUsable(tx, user, resultingTarget);
      }

      const updated = await tx.catalogField.update({
        where: { id: fieldId },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.fieldType !== undefined ? { fieldType: input.fieldType } : {}),
          ...(input.lookupCatalogId !== undefined
            ? { lookupCatalogId: input.lookupCatalogId }
            : {}),
          ...(input.required !== undefined ? { required: input.required } : {}),
          ...(input.position !== undefined ? { position: input.position } : {}),
          ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        },
      });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "catalogs.field_update",
        resourceType: "catalog_field",
        resourceId: fieldId,
        before: {
          label: current.label,
          fieldType: current.fieldType,
          isArchived: current.isArchived,
        },
        after: {
          label: updated.label,
          fieldType: updated.fieldType,
          isArchived: updated.isArchived,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return updated;
    });
  }

  /**
   * Quitar un campo. Devuelve `FieldRemovalBlocked` (no lanza) cuando hay
   * datos y falta confirmación: el caller lo traduce a un 409 con el conteo,
   * que es lo que la UI necesita para escribir "N registros tienen este
   * campo".
   */
  async remove(
    user: AuthUser,
    catalogId: string,
    fieldId: string,
    confirm: boolean,
    meta: RequestMeta,
  ): Promise<{ archived: boolean } | FieldRemovalBlocked> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const catalog = await this.findCatalogOrFail(tx, user, catalogId);
      const current = await tx.catalogField.findFirst({
        where: { id: fieldId, catalogId, tenantId: user.tenantId },
      });

      if (!current) {
        throw new NotFoundException({ message: "catalogs.field_not_found" });
      }

      const recordCount = await this.countRecordsUsingKey(tx, catalog, current.key);

      if (recordCount === 0) {
        // Nadie lo usó nunca: borrarlo de verdad no pierde nada y deja la
        // key libre para volver a usarla.
        await tx.catalogField.delete({ where: { id: fieldId } });
        await this.recordRemoval(tx, user, fieldId, current.key, false, meta);
        return { archived: false };
      }

      if (!confirm) {
        return { requiresConfirmation: true, recordCount };
      }

      // Con datos: se ARCHIVA. Los valores siguen en `attributes` — restaurar
      // el campo los devuelve como estaban.
      await tx.catalogField.update({ where: { id: fieldId }, data: { isArchived: true } });
      await this.recordRemoval(tx, user, fieldId, current.key, true, meta);
      return { archived: true };
    });
  }

  private async recordRemoval(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    fieldId: string,
    key: string,
    archived: boolean,
    meta: RequestMeta,
  ): Promise<void> {
    await this.auditService.record(tx, {
      tenantId: user.tenantId,
      userId: user.userId,
      action: archived ? "catalogs.field_archive" : "catalogs.field_delete",
      resourceType: "catalog_field",
      resourceId: fieldId,
      before: { key },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  private async findCatalogOrFail(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    catalogId: string,
  ): Promise<{ id: string; isSystem: boolean; systemKey: string | null }> {
    const catalog = await tx.catalog.findFirst({
      where: { id: catalogId, tenantId: user.tenantId },
      select: { id: true, isSystem: true, systemKey: true },
    });

    if (!catalog) {
      throw new NotFoundException({ message: "catalogs.not_found" });
    }

    return catalog;
  }

  private async assertLookupTargetUsable(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    lookupCatalogId: string,
  ): Promise<void> {
    const target = await tx.catalog.findFirst({
      where: { id: lookupCatalogId, tenantId: user.tenantId, isActive: true },
      select: { id: true },
    });

    if (!target) {
      // Un lookup hacia un catálogo archivado o ajeno dejaría el picker vacío
      // en runtime, sin explicación para quien carga los datos.
      throw new ConflictException({ message: "catalogs.lookup_target_unusable" });
    }
  }

  /**
   * Cuántos registros tienen ese campo cargado.
   *
   * Ojo con la bifurcación: las filas de un catálogo del SISTEMA viven en su
   * tabla de primera clase (products, warehouses o services — el registry de
   * system-catalogs.ts es la fuente única), las de un subcatálogo en
   * `catalog_records`. Es la única parte del motor donde esa diferencia
   * asoma, y olvidarla haría que archivar un campo dijera siempre
   * "0 registros" y borrara datos sin preguntar.
   *
   * SQL crudo porque Prisma no expresa la existencia de una clave en jsonb.
   * Se usa `jsonb_exists(...)` y NO el operador `?`: el `?` es también el
   * placeholder de parámetros de varios drivers, y mezclarlo con una query
   * parametrizada es pedir un bug raro. La forma de función es la misma
   * operación, sin ambigüedad.
   *
   * Va sin índice a propósito: `jsonb_path_ops` solo indexa `@>`, y este
   * conteo corre una vez al archivar un campo, no en un camino caliente.
   */
  private async countRecordsUsingKey(
    tx: Prisma.TransactionClient,
    catalog: { id: string; isSystem: boolean; systemKey: string | null },
    key: string,
  ): Promise<number> {
    const table = systemAttributeTable(catalog.systemKey);
    // `Prisma.raw` SOLO con la tabla salida del registry (lista cerrada):
    // un identificador no es parametrizable y el systemKey de la DB jamás
    // se interpola directo.
    const rows = table
      ? await tx.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM ${Prisma.raw(table)} WHERE jsonb_exists(attributes, ${key})`
      : await tx.$queryRaw<{ count: bigint }[]>`
          SELECT count(*) AS count FROM catalog_records
          WHERE catalog_id = ${catalog.id}::uuid AND jsonb_exists(attributes, ${key})`;

    return Number(rows[0]?.count ?? 0);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
