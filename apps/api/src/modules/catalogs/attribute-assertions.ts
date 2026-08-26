import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import type { AuthUser } from "../auth/types/auth-user";
import { type FieldDefinition, validateRecordAttributes } from "./validate-attributes";

/**
 * Validación de `attributes` compartida por TODO consumidor del motor de
 * campos dinámicos (2026-08-26): registros de subcatálogo, productos,
 * almacenes y servicios. Antes vivía duplicada (~55 líneas) en
 * products.service y catalog-records.service — dos copias que ya habían
 * empezado a divergir en las claves de error.
 *
 * Las claves i18n son del LLAMADOR: cada módulo reporta sus errores con su
 * propio prefijo (products.invalid_attributes, warehouses.invalid_attributes…)
 * y los errores POR CAMPO conservan las claves catalogs.* del validador.
 */

/** Los campos del catálogo, con el shape exacto que consume el validador. */
export function loadCatalogFields(
  tx: Prisma.TransactionClient,
  catalogId: string,
): Promise<FieldDefinition[]> {
  return tx.catalogField.findMany({
    where: { catalogId },
    select: {
      key: true,
      fieldType: true,
      required: true,
      isArchived: true,
      lookupCatalogId: true,
    },
  });
}

/**
 * Forma + existencia real de los lookups. La DB no puede garantizar la
 * segunda: el destino es un UUID dentro de un JSONB, no una columna con FK.
 */
export async function assertValidAttributes(
  tx: Prisma.TransactionClient,
  user: AuthUser,
  fields: FieldDefinition[],
  attributes: Record<string, unknown>,
  invalidMessage: string,
): Promise<void> {
  const errors = validateRecordAttributes(fields, attributes);
  if (errors.length > 0) {
    throw new BadRequestException({ message: invalidMessage, errors });
  }

  for (const field of fields) {
    if (field.isArchived || field.fieldType !== "lookup" || !field.lookupCatalogId) {
      continue;
    }

    const value = attributes[field.key];
    if (typeof value !== "string") {
      continue;
    }

    const target = await tx.catalogRecord.findFirst({
      where: {
        id: value,
        catalogId: field.lookupCatalogId,
        tenantId: user.tenantId,
        isActive: true,
      },
      select: { id: true },
    });

    if (!target) {
      throw new BadRequestException({
        message: invalidMessage,
        errors: [{ key: field.key, message: "catalogs.lookup_value_not_found" }],
      });
    }
  }
}

/**
 * El camino completo para una entidad de primera clase: resuelve su catálogo
 * del sistema por `systemKey`, carga los campos y valida. Un tenant sin ese
 * catálogo no debería existir (provision + backfill) — si pasa, fallar
 * fuerte es mejor que aceptar cualquier cosa.
 */
export async function assertSystemCatalogAttributes(
  tx: Prisma.TransactionClient,
  user: AuthUser,
  systemKey: string,
  attributes: Record<string, unknown>,
  messages: { invalid: string; catalogMissing: string },
): Promise<void> {
  const catalog = await tx.catalog.findFirst({
    where: { tenantId: user.tenantId, systemKey },
    select: { id: true },
  });

  if (!catalog) {
    throw new ConflictException({ message: messages.catalogMissing });
  }

  const fields = await loadCatalogFields(tx, catalog.id);
  await assertValidAttributes(tx, user, fields, attributes, messages.invalid);
}
