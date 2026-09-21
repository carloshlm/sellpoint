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
 *
 * F7-LIFECYCLE-10 — el enfriamiento de 30 días es para quien NUNCA pagó (una
 * prueba propia, un registro abandonado). Un CLIENTE —al menos un pago real
 * registrado— no se elimina al mes: sus datos se conservan lo que pide la ley
 * de su país, contado desde la desactivación, porque todo lo suyo es anterior
 * a ella. La misma regla vive en la base (`tenant_retention_years()`, que
 * `purge_tenant()` consulta antes de borrar) y un test de integración las ata.
 */
export const TENANT_DELETE_COOLING_DAYS = 30;

/**
 * Años que se conservan los datos de un cliente, por país (decisión de
 * Carlos, 2026-09-21): México 10 (Código de Comercio), Canadá 7 (CRA),
 * Estados Unidos 7 (IRS).
 */
export const TENANT_RETENTION_YEARS: Readonly<Record<string, number>> = {
  MX: 10,
  CA: 7,
  US: 7,
};

/** Un país que no está en la tabla toma el plazo MÁS largo: equivocarse hacia guardar es barato. */
export const TENANT_RETENTION_DEFAULT_YEARS = 10;

/** `country` llega de la base como `char(2)`: se normaliza aquí. */
export function tenantRetentionYears(country: string | null): number {
  const clave = country?.trim().toUpperCase() ?? "";
  return TENANT_RETENTION_YEARS[clave] ?? TENANT_RETENTION_DEFAULT_YEARS;
}

const DIA_MS = 24 * 60 * 60 * 1000;

export interface TenantLifecycle {
  /** ¿Está desactivado? */
  suspended: boolean;
  /** Días COMPLETOS desde la desactivación (0 si está activo). */
  suspendedDays: number;
  /** Años de retención legal si es CLIENTE; `null` si nunca pagó (aplican los 30 días). */
  retentionYears: number | null;
  /** Desde cuándo se puede eliminar; `null` si está activo. */
  deletableAt: Date | null;
  /** ¿Ya pasó el enfriamiento? */
  deletable: boolean;
}

/** Lo que la regla necesita saber de un negocio. */
export interface TenantLifecycleInput {
  suspendedAt: Date | string | null;
  country: string | null;
  /** ¿Tiene al menos un pago REAL (registrado, con importe y que no sea cortesía)? */
  hasRealPayments: boolean;
}

/**
 * `suspendedAt` puede venir como `Date` (Prisma) o como texto ISO (el JSON
 * del API): las dos se normalizan aquí y nadie más tiene que acordarse.
 */
export function tenantLifecycle(tenant: TenantLifecycleInput, now: Date): TenantLifecycle {
  const retentionYears = tenant.hasRealPayments ? tenantRetentionYears(tenant.country) : null;
  if (tenant.suspendedAt === null) {
    return {
      suspended: false,
      suspendedDays: 0,
      retentionYears,
      deletableAt: null,
      deletable: false,
    };
  }
  const desde = new Date(tenant.suspendedAt);
  // Años de CALENDARIO, no 365 días: «10 años» es la misma fecha diez años
  // después. (Un 29 de febrero cae en 1 de marzo; la base lo deja en 28 de
  // febrero: este lado es un día más estricto, que es el lado seguro.)
  const deletableAt = new Date(desde.getTime());
  if (retentionYears === null) {
    deletableAt.setTime(desde.getTime() + TENANT_DELETE_COOLING_DAYS * DIA_MS);
  } else {
    deletableAt.setUTCFullYear(desde.getUTCFullYear() + retentionYears);
  }
  return {
    suspended: true,
    suspendedDays: Math.max(0, Math.floor((now.getTime() - desde.getTime()) / DIA_MS)),
    retentionYears,
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
