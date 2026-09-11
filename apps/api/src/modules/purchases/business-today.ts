import { localCalendarDate } from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";

/**
 * El «hoy» del calendario del NEGOCIO (`tenants.timezone`), nunca el UTC del
 * servidor: a las 11 de la noche en Ciudad de México, «hoy» en UTC ya es
 * mañana y una factura del día rebotaría sin razón. Lo comparten Compras y
 * Órdenes de compra para «esta fecha no puede ser de mañana».
 */
export async function hoyDelNegocio(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<string> {
  const negocio = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: { timezone: true },
  });
  return localCalendarDate(negocio?.timezone ?? "UTC", new Date());
}
