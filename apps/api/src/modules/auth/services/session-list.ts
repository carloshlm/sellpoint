/**
 * F1-WEB-AUTH-10 — `GET /auth/sessions`.
 *
 * Una "sesión activa" NO es un refresh token: es una FAMILIA. Cada rotación
 * (AD-6) crea una fila nueva dentro de la misma familia, así que una sesión de
 * una semana puede tener decenas de filas. Esta función colapsa las filas
 * vivas en una entrada por familia.
 *
 * Decisión (documentada porque hay dos lecturas razonables):
 * - `createdAt` = el token MÁS VIEJO de la familia → "desde cuándo existe esta
 *   sesión" (el login que la abrió). Usar el vigente daría la hora del último
 *   refresh, que cambia sola cada 15 min y no significa nada para el usuario.
 * - `expiresAt` = el token MÁS NUEVO → "cuándo muere si no la usás", que es el
 *   dato accionable (sliding window: cada rotación empuja el vencimiento).
 *
 * Pura a propósito: la parte con criterio se testea sin Prisma ni mocks.
 *
 * `RefreshToken` NO guarda userAgent ni IP (verificado en schema.prisma), así
 * que no hay "Chrome en Windows" para mostrar — se devuelve SOLO lo que
 * existe. Y nunca el `tokenHash`: el shape de salida se construye campo por
 * campo, jamás con spread de la fila.
 */

/** Subconjunto de `RefreshToken` que esta función necesita (nada de hashes). */
export interface RefreshTokenFamilyRow {
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface SessionSummary {
  familyId: string;
  createdAt: Date;
  expiresAt: Date;
  /** La familia de la cookie `sp_refresh` con la que llegó ESTE request. */
  current: boolean;
}

export function groupSessionsByFamily(
  rows: readonly RefreshTokenFamilyRow[],
  currentFamilyId: string | null,
): SessionSummary[] {
  const byFamily = new Map<string, { createdAt: Date; expiresAt: Date }>();

  for (const row of rows) {
    const found = byFamily.get(row.familyId);

    if (!found) {
      byFamily.set(row.familyId, { createdAt: row.createdAt, expiresAt: row.expiresAt });
      continue;
    }

    if (row.createdAt < found.createdAt) {
      found.createdAt = row.createdAt;
    }
    if (row.expiresAt > found.expiresAt) {
      found.expiresAt = row.expiresAt;
    }
  }

  return [...byFamily.entries()]
    .map(([familyId, span]) => ({
      familyId,
      createdAt: span.createdAt,
      expiresAt: span.expiresAt,
      current: familyId === currentFamilyId,
    }))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
