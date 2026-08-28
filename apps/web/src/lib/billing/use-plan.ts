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
    // El vencimiento ya pasó y el barrido todavía no lo procesó: solo para
    // AVISAR — el corte lo sigue decidiendo `writeAccess`, que viene del
    // estado que el cron persiste.
    overdue: subscription?.overdue ?? false,
    dueAt: subscription?.dueAt ?? null,
    canWrite: subscription?.writeAccess ?? false,
    stockControl: subscription?.stockControl ?? false,
    dailySalesLimit: subscription?.dailySalesLimit ?? null,
    hasFeature: (feature: keyof PlanFeatures): boolean => subscription?.features[feature] === true,
  };
}
