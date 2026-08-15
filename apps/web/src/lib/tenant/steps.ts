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
 * Paso 3 (almacén, F1-WEB-ONBOARD-03): placeholder informativo SIN dato
 * real (el CRUD sigue siendo F2, D2) — no hay, ni hace falta, una señal
 * server-side de "ya lo vi". Con negocio y plantilla completos el piso YA
 * es 4: `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))`
 * sigue mostrando el paso 3 cuando SE PIDE explícitamente (`goToStep(3)` al
 * terminar el paso 2, ver `routes/onboarding.tsx`), pero nada se pierde si
 * el piso ya permite saltar directo al 4 — el paso 3 no tiene estado que
 * conservar.
 *
 * W4 (verify-report #357): esto REVIERTE la Deviation 6
 * (`Tenant.warehouseStepSeen`, apply-progress F1-WEB-ONBOARD-03). La
 * justificación original ("sin la señal, Continuar en el paso 3 rebotaría
 * al mismo paso") solo era cierta si el piso se quedaba en 3 — la
 * alternativa correcta es dejar que el piso avance a 4 apenas hay
 * `templateChoice`, sin columna nueva ni escritura adicional.
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
