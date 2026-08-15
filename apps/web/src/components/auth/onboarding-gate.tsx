import { Navigate } from "@tanstack/react-router";
import type * as React from "react";
import { SessionLoading } from "@/components/auth/session-loading";
import { usePermissions } from "@/lib/auth/permissions";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-ONBOARD-01 (design A2). Compuesto DENTRO de `ProtectedRoute`
 * (`<ProtectedRoute><OnboardingGate>…`) en las rutas protegidas — NUNCA en
 * `/onboarding` (esa ruta es el DESTINO del redirect; envolverla acá
 * recrearía el loop que este componente evita por CONSTRUCCIÓN, no por
 * condicional).
 *
 * Orden de decisión:
 * 1. `accessToken && !user` (ventana de bootstrap, S6/#321): loading, NUNCA
 *    `<Navigate/>` — evita el flash si el bootstrap resuelve "onboarded"
 *    distinto a como arrancó.
 * 2. `tenant.onboarded`: children — nada que hacer.
 * 3. Sin `tenants:manage` (D4): children — un invitado de un tenant a medio
 *    configurar NO se empuja al wizard, ve el dashboard igual que cualquier
 *    otro sin ese permiso.
 * 4. Resto (onboarded=false + tenants:manage): `/onboarding`.
 */
function OnboardingGate({ children }: { children: React.ReactNode }) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const user = useAuthStore((state) => state.user);
  const { has } = usePermissions();

  if (accessToken && !user) {
    return <SessionLoading />;
  }

  if (!user || user.tenant.onboarded) {
    return <>{children}</>;
  }

  if (!has("tenants:manage")) {
    return <>{children}</>;
  }

  // W1 (verify-report #357): SIN `step` — `/onboarding` deriva el paso
  // efectivo del tenant (`primerPasoIncompleto`), no de un `step: 1` fijo
  // impuesto acá. Forzarlo a 1 hacía que un tenant con pasos ya completos
  // volviera a ver el form del paso 1 al recargar la página o volver días
  // después.
  return <Navigate to="/onboarding" replace />;
}

export { OnboardingGate };
