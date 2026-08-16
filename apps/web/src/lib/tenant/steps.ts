import type { TenantBlock } from "./api";

/**
 * F1-WEB-ONBOARD-01 (design A3): el paso EFECTIVO del wizard nace de acá,
 * nunca de `useState` ni de localStorage — pura, sin React, testeable sola.
 * `routes/onboarding.tsx` la usa como
 * `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))`.
 *
 * Paso 1 (negocio): completo cuando country + legalName + taxId + address
 * están presentes — los 4 son requeridos por el form del paso 1 (`timezone`
 * y `currency` siempre tienen default en el backend, no sirven como señal).
 * `country` se sumó ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md §2):
 * consecuencia deliberada, un tenant que YA había completado el paso 1
 * antes de este cambio (country en NULL) vuelve a caer acá hasta elegirlo.
 *
 * Paso 2 (campos del catálogo, F2-ONBOARD-01/02): completo cuando
 * `templateChoice` no es null. La columna SIGUE existiendo y se sigue
 * escribiendo, pero ya NO significa "eligió una plantilla de rubro": desde la
 * LEY de genericidad (2026-08-16) el paso 2 deja definir campos propios y
 * `templateChoice` es solo la marca de "pasó por acá". Los Layouts por rubro
 * son Fase 9.0.
 *
 * Paso 3 (almacén, F2-ONBOARD-03): completo cuando el tenant tiene AL MENOS
 * UN almacén. Dejó de ser un placeholder sin dato: desde F2-DB-07 la tabla
 * existe y el paso crea uno de verdad, así que hay una señal server-side
 * natural y no hace falta una columna "ya lo vi" (la Deviation 6 que W4
 * revirtió).
 *
 * Consecuencia deliberada: un tenant que completó el onboarding en Fase 1
 * vuelve a caer en el paso 3 hasta crear su primer almacén. Sin almacén no
 * puede haber stock, así que el wizard estaría mintiendo si lo dejara pasar.
 *
 * W4 (verify-report #357): esto REVIERTE la Deviation 6
 * (`Tenant.warehouseStepSeen`, apply-progress F1-WEB-ONBOARD-03). La
 * justificación original ("sin la señal, Continuar en el paso 3 rebotaría
 * al mismo paso") solo era cierta si el piso se quedaba en 3 — la
 * alternativa correcta es dejar que el piso avance a 4 apenas hay
 * `templateChoice`, sin columna nueva ni escritura adicional.
 */
export function primerPasoIncompleto(
  tenant: TenantBlock,
  options: { hasWarehouse?: boolean } = {},
): 1 | 2 | 3 | 4 {
  if (!tenant.country || !tenant.legalName || !tenant.taxId || !tenant.address) {
    return 1;
  }
  if (!tenant.templateChoice) {
    return 2;
  }
  // `hasWarehouse` llega del container, que ya tiene la lista cargada. Se pasa
  // como opción y no se consulta acá para que esta función siga siendo PURA y
  // testeable sin React ni red.
  if (options.hasWarehouse === false) {
    return 3;
  }
  return 4;
}
