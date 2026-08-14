/**
 * Formato de las claves del throttle de auth, en UN solo lugar.
 *
 * Las escribe `AuthEmailThrottlerGuard` (al contar intentos) y las BORRA
 * `AuthService.login` cuando la autenticación tiene éxito — dos archivos
 * distintos operando sobre las mismas claves, así que el formato no puede
 * vivir duplicado en literales.
 */

export function authIpThrottleKey(ip: string | undefined): string {
  return `throttle:auth-ip:${ip}`;
}

export function authEmailThrottleKey(email: string): string {
  return `throttle:auth-email:${email}`;
}

/** Misma normalización en el guard y en el borrado: si difieren, no matchean. */
export function normalizeThrottleEmail(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "" ? undefined : normalized;
}
