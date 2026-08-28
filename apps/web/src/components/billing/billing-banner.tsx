import { useTranslation } from "react-i18next";
import { usePlan } from "@/lib/billing/use-plan";
import { useBillingStore } from "@/stores/billing.store";

/**
 * F7-WEB-06 — el estado del plan siempre a la vista, dentro de `AppLayout`
 * (no en `__root`: sin sesión no hay suscripción que anunciar). `active` no
 * pinta NADA — un plan al corriente no necesita recordatorios. El banner es
 * clickeable hacia el modal de planes: el aviso y la salida, juntos.
 */
export function BillingBanner() {
  const { t } = useTranslation();
  const { status, daysLeft, planCode, dailySalesLimit } = usePlan();
  const openPlansModal = useBillingStore((state) => state.openPlansModal);

  if (status === "trialing") {
    return (
      <button
        type="button"
        data-testid="billing-banner"
        onClick={openPlansModal}
        className="w-full bg-primary/10 px-4 py-2 text-center text-primary text-sm"
      >
        {t("common.billing.banner.trial", { count: daysLeft ?? 0 })}
      </button>
    );
  }

  if (status === "past_due") {
    return (
      <button
        type="button"
        data-testid="billing-banner"
        onClick={openPlansModal}
        className="w-full bg-destructive px-4 py-2 text-center text-destructive-foreground text-sm"
      >
        {t("common.billing.banner.pastDue", { count: daysLeft ?? 0 })}
      </button>
    );
  }

  if (status === "free" || (status === "canceled" && planCode === "free")) {
    return (
      <button
        type="button"
        data-testid="billing-banner"
        onClick={openPlansModal}
        className="w-full bg-muted px-4 py-2 text-center text-muted-foreground text-sm"
      >
        {t("common.billing.banner.free", { limit: dailySalesLimit ?? 10 })}
      </button>
    );
  }

  return null;
}
