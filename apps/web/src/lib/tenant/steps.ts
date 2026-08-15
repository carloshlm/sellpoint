import type { TenantBlock } from "./api";

/**
 * F1-WEB-ONBOARD-01 (design A3): el paso EFECTIVO del wizard nace de acá,
 * nunca de `useState` ni de localStorage — pura, sin React, testeable sola.
 * `routes/onboarding.tsx` la usa como
 * `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))`.
 *
 * Paso 1 (negocio): completo cuando legalName + taxId + address están
 * presentes — los 3 son requeridos por el form del paso 1 (`timezone` y
 * `currency` siempre tienen default en el backend, no sirven como señal).
 *
 * Paso 2 (plantilla): completo cuando `templateChoice` no es null.
 *
 * Paso 3 (almacén): el spec lo define informativo, "continuar SIN persistir
 * campos nuevos" — no existe ningún campo de `TenantBlock` que distinga
 * "todavía no lo vio" de "ya avanzó". Con el paso 2 completo, el piso salta
 * directo a 4: no hay nada que perder al saltar un paso sin estado propio,
 * y `effectiveStep = min(stepPedido, piso)` igual deja visitarlo navegando
 * hacia adelante dentro de la misma sesión (F1-WEB-ONBOARD-02/03 lo cablean).
 */
export function primerPasoIncompleto(tenant: TenantBlock): 1 | 2 | 3 | 4 {
  if (!tenant.legalName || !tenant.taxId || !tenant.address) {
    return 1;
  }
  if (!tenant.templateChoice) {
    return 2;
  }
  return 4;
}
