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
 * Paso 3 (almacén, F1-WEB-ONBOARD-03, todavía sin implementar): con negocio
 * y plantilla completos, el piso RETOMA en 3 — no salta directo a 4. La
 * versión anterior (F1-WEB-ONBOARD-01) saltaba a 4 porque `templateChoice`
 * todavía no existía como señal real; ahora que el paso 2 persiste de
 * verdad, saltarlo ocultaría el paso 3 apenas se implemente. `tenant.onboarded`
 * es la única excepción: si el wizard ya se completó, el piso defensivamente
 * es 4 (el `OnboardingGate` de todas formas ya no monta el wizard en ese
 * caso — ver test "tenant ya onboarded").
 */
export function primerPasoIncompleto(tenant: TenantBlock): 1 | 2 | 3 | 4 {
  if (!tenant.legalName || !tenant.taxId || !tenant.address) {
    return 1;
  }
  if (!tenant.templateChoice) {
    return 2;
  }
  if (tenant.onboarded) {
    return 4;
  }
  return 3;
}
