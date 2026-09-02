import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { PaymentHistoryTable } from "@/components/billing/payment-history-table";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePermissions } from "@/lib/auth/permissions";
import { getMyBilling } from "@/lib/billing/api";
import { formatDeadline } from "@/lib/billing/dates";
import { usePlan } from "@/lib/billing/use-plan";
import { useAuthStore } from "@/stores/auth.store";
import { useBillingStore } from "@/stores/billing.store";

export const Route = createFileRoute("/settings/billing")({
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <BillingSettings />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F7-WEB-09 — "Mi plan": el estado del ciclo de cobro del negocio, con su
 * historial de pagos. Solo `tenants:manage` (mismo criterio que los datos
 * del negocio: sin el permiso, la pantalla NO existe — no se deshabilita).
 */
function BillingSettings() {
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const { subscription, daysLeft } = usePlan();
  const openPlansModal = useBillingStore((state) => state.openPlansModal);
  // Al tope con los demás hooks: abajo hay un early return, y un hook
  // después de un `return` se llama en un orden distinto en cada render.
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);

  const { data } = useQuery({
    queryKey: ["billing", "me"],
    queryFn: getMyBilling,
    enabled: has("tenants:manage"),
  });

  if (!has("tenants:manage")) {
    return null;
  }

  const locale = i18n.language === "en" ? "en" : "es";
  // `vence` es para un límite ABIERTO: formatear el instante crudo muestra
  // un día de más justo en la pantalla del cobro.
  const vence = (iso: string | null) => formatDeadline(iso, timeZone, locale);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Card data-testid="my-plan">
        <CardHeader>
          <CardTitle>{t("common.billing.me.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="font-medium">{subscription?.planName ?? "—"}</span>
            {" · "}
            {t(`common.billing.me.status.${subscription?.status ?? "free"}`)}
          </p>
          {subscription?.status === "trialing" && daysLeft !== null ? (
            <p>{t("common.billing.me.trialDays", { count: daysLeft })}</p>
          ) : null}
          {data?.subscription.dueAt ? (
            <p>
              {/* Llamar "próximo pago" a una fecha que ya pasó es mentirle al
                  cliente sobre su propia situación. */}
              {t(subscription?.overdue ? "common.billing.me.dueWas" : "common.billing.me.nextDue", {
                date: vence(data.subscription.dueAt),
              })}
            </p>
          ) : null}
          {data?.activeDiscount ? (
            <p>
              {t("common.billing.me.discount", {
                amount: data.activeDiscount.amount ?? "",
                used: data.activeDiscount.appliedPeriods,
                total: data.activeDiscount.maxPeriods ?? "∞",
              })}
            </p>
          ) : null}
          <Button type="button" variant="outline" onClick={openPlansModal}>
            {t("common.billing.me.viewPlans")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.billing.me.history")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/*
            La MISMA tabla que el backoffice (Carlos, 2026-09-02): el cliente
            reconoce sus pagos con el mismo código de color, y «Ver» le abre
            abajo el detalle — incluido el período que cubrió cada pago, que es
            la respuesta a "¿hasta cuándo tengo pagado?".
          */}
          <PaymentHistoryTable
            payments={data?.payments}
            timeZone={timeZone}
            locale={locale}
            emptyText={t("common.billing.me.noPayments")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
