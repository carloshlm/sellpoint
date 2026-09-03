import { localCalendarDate } from "@sellpoint/shared";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service";

type Tx = Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0];

/**
 * Qué día es HOY para este negocio (F9-CLINIC-26).
 *
 * El candado del expediente compara contra el día del NEGOCIO, no el del
 * servidor: a las 23:30 de CDMX ya es mañana en UTC, y la consulta que el
 * médico tiene abierta no puede vencerse por eso. Se lee dentro de la misma
 * transacción para que el chequeo y la escritura vean la misma zona.
 */
export async function diaDelNegocio(tx: Tx, tenantId: string): Promise<string> {
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { timezone: true },
  });
  return localCalendarDate(tenant.timezone ?? "UTC", new Date());
}
