import type { AuthUser } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "./subscription-fixture";
import { buildTenantBlock } from "./tenant-fixture";

/**
 * F1-NAME-01 — el usuario autenticado de los fixtures de test: Ana Pérez, sin
 * permisos, en el negocio demo con su plan Plus de prueba.
 *
 * Antes cada test armaba el literal completo a mano (62 archivos), casi
 * siempre dentro de un `demoUser(permissions)` local idéntico al de al lado.
 * Cada campo nuevo de `AuthUser` costaba decenas de ediciones iguales — y el
 * rename de `lastName` a `lastName` (F1-NAME-06) habría costado 42.
 * Ahora un campo nuevo es una línea acá, y cada test escribe solo lo que le
 * importa.
 *
 * `permissions: []` a propósito: sin privilegios es el estado seguro, y así
 * un test que necesita una llave la NOMBRA en vez de heredarla sin querer.
 */
export const AUTH_USER_DEMO: AuthUser = {
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastName: "Pérez",
  secondLastName: null,
  locale: "es",
  permissions: [],
  subscription: SUBSCRIPTION_PLUS,
  tenant: buildTenantBlock(),
};

/**
 * El `tenant` se COPIA del demo en cada llamada, no se reconstruye: así el
 * negocio por defecto se declara en UN solo lugar (arriba) y, de paso, un test
 * que lo mute no puede contaminar al de al lado.
 */
export function buildAuthUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return { ...AUTH_USER_DEMO, tenant: { ...AUTH_USER_DEMO.tenant }, ...overrides };
}
