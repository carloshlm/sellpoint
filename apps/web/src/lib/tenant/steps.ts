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
 * Paso 3 (almacén, F1-WEB-ONBOARD-03): con negocio y plantilla completos, el
 * piso RETOMA en 3 — no salta directo a 4 — hasta que `warehouseStepSeen`
 * quede en `true`. `warehouseStepSeen` NO es dato real de almacén (el CRUD
 * sigue siendo F2, D2): es la única señal server-side de que el paso 3
 * (placeholder informativo) ya se recorrió. Sin ella, "Continuar" en el
 * paso 3 rebotaría al mismo paso incluso SIN recargar la página, porque
 * `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))` seguiría
 * viendo el piso en 3 (apply-progress Deviation 6, F1-WEB-ONBOARD-03).
 * `tenant.onboarded` sigue siendo la excepción defensiva: si el wizard ya
 * se completó, el piso es 4 (el `OnboardingGate` de todas formas ya no
 * monta el wizard en ese caso — ver test "tenant ya onboarded").
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
  if (!tenant.warehouseStepSeen) {
    return 3;
  }
  return 4;
}
