import type { PlanFeatures } from "@sellpoint/shared";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F7-WEB-04 — la lectura del plan efectivo para la UI. La regla de la casa:
 * el PERMISO decide si el rol puede; el FEATURE decide si el plan incluye —
 * este hook responde lo segundo. Sin sesión (o sin bloque aún) responde
 * fail-closed: nada de features, sin escritura.
 */
export function usePlan() {
  const subscription = useAuthStore((state) => state.user?.subscription ?? null);

  return {
    subscription,
    planCode: subscription?.planCode ?? null,
    status: subscription?.status ?? null,
    daysLeft: subscription?.daysLeft ?? null,
    canWrite: subscription?.writeAccess ?? false,
    stockControl: subscription?.stockControl ?? false,
    dailySalesLimit: subscription?.dailySalesLimit ?? null,
    hasFeature: (feature: keyof PlanFeatures): boolean => subscription?.features[feature] === true,
  };
}
