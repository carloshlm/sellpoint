import type { ApiError } from "./api";

/**
 * Qué decirle a quien mira una pantalla que no cargó.
 *
 * «No pudimos cargar los usuarios» es verdad y no sirve: no distingue una
 * sesión vencida de un permiso que falta o de un servidor caído, y las tres
 * se arreglan de forma distinta (Carlos, 2026-09-04).
 *
 * El criterio, por rango:
 *  - **red (0)**: no llegó la petición; nada que ver con permisos.
 *  - **401**: la sesión murió. El interceptor ya intentó renovarla, así que
 *    si el error llegó hasta acá hay que volver a entrar.
 *  - **403**: el usuario está bien, le falta el permiso.
 *  - **otro 4xx**: el backend ya explicó el motivo en el idioma del usuario
 *    (402 de plan, 409 de conflicto…). Se muestra tal cual: sabe más que
 *    nosotros.
 *  - **5xx**: se rompió del lado del servidor. Su texto es para quien lee
 *    logs, no para quien vende, así que se traga y se dice lo que pasó.
 *
 * `fallbackKey` es la frase propia de la pantalla, para cuando no hay error
 * o el backend se quedó mudo.
 */
export function apiErrorMessage(
  t: (key: string) => string,
  error: ApiError | null | undefined,
  fallbackKey: string,
): string {
  if (!error) {
    return t(fallbackKey);
  }
  if (error.statusCode === 0) {
    return t("common.errors.network");
  }
  if (error.statusCode === 401) {
    return t("common.errors.sessionExpired");
  }
  if (error.statusCode === 403) {
    return t("common.errors.forbidden");
  }
  if (error.statusCode >= 500) {
    return t("common.errors.server");
  }
  return error.message !== "" ? error.message : t(fallbackKey);
}
