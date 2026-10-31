import {
  addressAsksRegion,
  isAddressRegionCode,
  isPostalCode,
  normalizePostalCode,
} from "@sellpoint/shared";
import type { Prisma } from "../generated/prisma/client";

/** La parte de una dirección cuya regla depende del país del negocio. */
export interface CountryAddressInput {
  region?: string | null;
  postalCode?: string | null;
}

/**
 * La excepción que lanza cada recurso. La regla es UNA; la clave de error (y
 * el status) son de quien llama: Sucursales responde `warehouses.*` y
 * Proveedores `suppliers.*`.
 */
export interface AddressValidationErrors {
  invalidRegion: () => Error;
  invalidPostalCode: () => Error;
}

/**
 * F1-ADDR-03 — la región y el CP de una dirección se validan contra el país
 * del NEGOCIO (`tenants.country`): una sucursal o un proveedor lo heredan. El
 * CP se devuelve normalizado (`M5V 3L9`) y vacío queda en `null`. Sin región
 * ni CP en el input no hay nada que mirar y no se consulta el tenant.
 *
 * Nació como `WarehousesService#conDireccionValidada`; vive aquí desde que
 * Proveedores homologó su dirección con la de Sucursales (Carlos, 2026-10-31),
 * para que las dos pantallas apliquen exactamente la misma regla.
 */
export async function withValidatedTenantAddress<T extends CountryAddressInput>(
  tx: Prisma.TransactionClient,
  tenantId: string,
  input: T,
  errors: AddressValidationErrors,
): Promise<T> {
  if (input.region == null && input.postalCode == null) return input;
  const { country } = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { country: true },
  });
  if (
    input.region != null &&
    !(addressAsksRegion(country) && isAddressRegionCode(country, input.region))
  ) {
    throw errors.invalidRegion();
  }
  if (input.postalCode == null) return input;
  const postalCode = normalizePostalCode(country, input.postalCode);
  if (!isPostalCode(country, postalCode)) {
    throw errors.invalidPostalCode();
  }
  return { ...input, postalCode: postalCode === "" ? null : postalCode };
}
