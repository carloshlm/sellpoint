import type { TenantBlock } from "./api";

/**
 * F1-WEB-ONBOARD-01 (design A3): el paso EFECTIVO del wizard nace de acá,
 * nunca de `useState` ni de localStorage — pura, sin React, testeable sola.
 * `routes/onboarding.tsx` la usa como
 * `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))`.
 *
 * El wizard de 3 pasos (Carlos, 2026-08-25) — antes eran 4: el paso de
 * campos del catálogo y el de invitar al equipo se quitaron para agilizar el
 * registro; ambos siguen disponibles después (Catálogo → Campos y
 * Sistema → Usuarios). `templateChoice` quedó como columna muerta: ya no se
 * escribe ni participa del piso.
 *
 * Paso 1 (negocio): completo cuando country + legalName + taxId + address
 * están presentes — los 4 son requeridos por el form del paso 1 (`timezone`
 * y `currency` siempre tienen default en el backend, no sirven como señal).
 * Desde 2026-08-25 el paso 1 también NOMBRA al negocio (name = legalName):
 * el registro ya no lo pide.
 *
 * Paso 2 (almacén): completo cuando el tenant tiene AL MENOS UN almacén —
 * la señal server-side natural (F2-DB-07), sin columna "ya lo vi".
 *
 * Paso 3 (tema): el último. `theme` en NULL significa que no lo eligió
 * todavía; elegirlo y Terminar completan el onboarding. No participa del
 * piso porque después del almacén ya no hay nada que saltarse.
 */
export function primerPasoIncompleto(
  tenant: TenantBlock,
  options: { hasWarehouse?: boolean } = {},
): 1 | 2 | 3 {
  if (!tenant.country || !tenant.legalName || !tenant.taxId || !tenant.address) {
    return 1;
  }
  // `hasWarehouse` llega del container, que ya tiene la lista cargada. Se pasa
  // como opción y no se consulta acá para que esta función siga siendo PURA y
  // testeable sin React ni red.
  if (options.hasWarehouse === false) {
    return 2;
  }
  return 3;
}
