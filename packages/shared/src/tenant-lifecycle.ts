import { z } from "zod";

/**
 * F7-LIFECYCLE-01 — el ciclo de vida de un negocio, en CÓDIGO compartido.
 *
 * Dos estados que no se mezclan con la suscripción: *desactivado* («ya no
 * entra», reversible, con fecha y motivo) y *eliminado* (irreversible). Entre
 * uno y otro hay un enfriamiento: un negocio solo se puede eliminar cuando
 * lleva al menos `TENANT_DELETE_COOLING_DAYS` desactivado. Ese mes es cuando
 * el cliente escribe diciendo «me equivoqué».
 *
 * El API decide con esta función si acepta el DELETE y el web pinta con ella
 * «se podrá eliminar a partir de…»: una sola verdad para la regla.
 */
export const TENANT_DELETE_COOLING_DAYS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

export interface TenantLifecycle {
  /** ¿Está desactivado? */
  suspended: boolean;
  /** Días COMPLETOS desde la desactivación (0 si está activo). */
  suspendedDays: number;
  /** Desde cuándo se puede eliminar; `null` si está activo. */
  deletableAt: Date | null;
  /** ¿Ya pasó el enfriamiento? */
  deletable: boolean;
}

/**
 * `suspendedAt` puede venir como `Date` (Prisma) o como texto ISO (el JSON
 * del API): las dos se normalizan aquí y nadie más tiene que acordarse.
 */
export function tenantLifecycle(
  tenant: { suspendedAt: Date | string | null },
  now: Date,
): TenantLifecycle {
  if (tenant.suspendedAt === null) {
    return { suspended: false, suspendedDays: 0, deletableAt: null, deletable: false };
  }
  const desde = new Date(tenant.suspendedAt);
  const deletableAt = new Date(desde.getTime() + TENANT_DELETE_COOLING_DAYS * DIA_MS);
  return {
    suspended: true,
    suspendedDays: Math.max(0, Math.floor((now.getTime() - desde.getTime()) / DIA_MS)),
    deletableAt,
    deletable: now.getTime() >= deletableAt.getTime(),
  };
}

/** Desactivar exige decir por qué: sin motivo, dentro de un mes nadie recuerda. */
export const suspendTenantSchema = z.object({
  reason: z.string().trim().min(5).max(300),
});
export type SuspendTenantInput = z.infer<typeof suspendTenantSchema>;

/**
 * Eliminar exige la contraseña del PROPIO administrador (se verifica contra
 * su hash, por eso no se recorta) y el nombre exacto del negocio.
 */
export const deleteTenantSchema = z.object({
  password: z.string().min(1),
  confirmName: z.string().trim().min(1),
});
export type DeleteTenantInput = z.infer<typeof deleteTenantSchema>;
