import { useTranslation } from "react-i18next";
import { formatDeadline } from "@/lib/billing/dates";
import { usePlan } from "@/lib/billing/use-plan";
import { useAuthStore } from "@/stores/auth.store";
import { useBillingStore } from "@/stores/billing.store";

/**
 * F7-WEB-06 — el estado del plan siempre a la vista, dentro de `AppLayout`
 * (no en `__root`: sin sesión no hay suscripción que anunciar). `active` no
 * pinta NADA — un plan al corriente no necesita recordatorios. El banner es
 * clickeable hacia el modal de planes: el aviso y la salida, juntos.
 */
export function BillingBanner() {
  const { t, i18n } = useTranslation();
  // La zona del NEGOCIO: su fecha de cobro no cambia porque el dueño abra la
  // app desde otro país.
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const { status, daysLeft, planCode, dailySalesLimit, overdue, dueAt } = usePlan();
  const openPlansModal = useBillingStore((state) => state.openPlansModal);

  /**
   * El vencimiento ya pasó y el barrido de las 3 AM todavía no lo procesó.
   * Va PRIMERO —antes que cualquier otro estado— porque es la noticia más
   * urgente que puede tener el negocio en pantalla, y porque sin esto no
   * veía nada entre que su pago vencía y que el cron lo movía.
   *
   * El instante guardado es límite ABIERTO (el arranque del día siguiente al
   * último día hábil), así que la fecha que el cliente reconoce como "su
   * vencimiento" es la del milisegundo anterior.
   */
  if (overdue && dueAt) {
    return (
      <button
        type="button"
        data-testid="billing-banner"
        onClick={openPlansModal}
        className="w-full bg-destructive px-4 py-2 text-center text-destructive-foreground text-sm"
      >
        {t("common.billing.banner.overdue", {
          date: formatDeadline(dueAt, timeZone, i18n.language),
        })}
      </button>
    );
  }

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
