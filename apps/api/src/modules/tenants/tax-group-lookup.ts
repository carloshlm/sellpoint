import { UnprocessableEntityException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";

/**
 * F4-TAX-10 — el grupo que un artículo nombra tiene que ser DEL negocio.
 *
 * La base no lo frena: la comprobación de una FK corre con los privilegios
 * del dueño de la tabla y la RLS no la alcanza (fijado en
 * `taxes-schema.integration.spec.ts`). Quien lo frena es esta función, en
 * los cuatro catálogos con precio. `null` es válido: «el default del negocio».
 */
export async function assertTaxGroupOfTenant(
  tx: Prisma.TransactionClient,
  tenantId: string,
  taxGroupId: string | null | undefined,
): Promise<void> {
  if (taxGroupId === null || taxGroupId === undefined) return;
  const existe = await tx.taxGroup.count({ where: { id: taxGroupId, tenantId } });
  if (existe === 0) {
    throw new UnprocessableEntityException({ message: "catalogs.tax_group_unknown" });
  }
}
