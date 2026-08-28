import { formatMoney } from "@sellpoint/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { getPlans } from "@/lib/billing/api";
import { usePlan } from "@/lib/billing/use-plan";
import { useBillingStore } from "@/stores/billing.store";

/**
 * F7-WEB-04 — la vitrina de planes. Se abre desde el PlanGate (free tier),
 * el interceptor 402 y los candados del sidebar. Los precios llegan YA
 * resueltos por el país del negocio: el front solo formatea.
 *
 * Sin botón de pago: el cobro de esta fase es MANUAL — el CTA invita a
 * contactar y el dueño de la plataforma registra el pago en su backoffice.
 */
export function PlansModal() {
  const { t, i18n } = useTranslation();
  const open = useBillingStore((state) => state.plansModalOpen);
  const close = useBillingStore((state) => state.closePlansModal);
  const { planCode } = usePlan();
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

  const { data: plans } = useQuery({
    queryKey: ["billing", "plans"],
    queryFn: getPlans,
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });

  const locale = i18n.language === "en" ? "en" : "es";

  return (
    <Dialog open={open} onClose={close} title={t("common.billing.plans.title")}>
      <div className="mb-4 flex justify-center gap-2">
        <Button
          type="button"
          variant={cycle === "monthly" ? "default" : "outline"}
          onClick={() => setCycle("monthly")}
        >
          {t("common.billing.plans.monthly")}
        </Button>
        <Button
          type="button"
          variant={cycle === "yearly" ? "default" : "outline"}
          onClick={() => setCycle("yearly")}
        >
          {t("common.billing.plans.yearly")}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(plans ?? []).map((plan) => (
          <div
            key={plan.code}
            className={`flex flex-col rounded-lg border p-4 ${
              plan.code === planCode ? "border-primary" : ""
            }`}
          >
            <h3 className="font-semibold text-base">{plan.name}</h3>
            {plan.description ? (
              <p className="mt-1 text-muted-foreground text-sm">{plan.description}</p>
            ) : null}

            <div className="my-3">
              {plan.price ? (
                <p className="font-bold text-2xl">
                  {formatMoney(
                    Number(cycle === "yearly" ? plan.price.yearly : plan.price.monthly),
                    // biome-ignore lint/suspicious/noExplicitAny: la moneda viene del catálogo del server
                    plan.price.currency as any,
                    locale,
                  )}
                  <span className="font-normal text-muted-foreground text-sm">
                    {cycle === "yearly"
                      ? t("common.billing.plans.perYear")
                      : t("common.billing.plans.perMonth")}
                  </span>
                </p>
              ) : (
                <p className="font-bold text-2xl">{t("common.billing.plans.customPrice")}</p>
              )}
            </div>

            <ul className="mb-4 space-y-1 text-sm">
              {plan.maxUsers !== null ? (
                <li>{t("common.billing.plans.maxUsers", { count: plan.maxUsers })}</li>
              ) : (
                <li>{t("common.billing.plans.unlimitedUsers")}</li>
              )}
              {plan.maxWarehouses !== null ? (
                <li>{t("common.billing.plans.maxWarehouses", { count: plan.maxWarehouses })}</li>
              ) : (
                <li>{t("common.billing.plans.unlimitedWarehouses")}</li>
              )}
            </ul>

            <div className="mt-auto">
              {plan.code === planCode ? (
                <p className="text-center font-medium text-primary text-sm">
                  {t("common.billing.plans.current")}
                </p>
              ) : (
                <p className="text-center text-muted-foreground text-sm">
                  {t("common.billing.plans.contact")}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-muted-foreground text-sm">
        {t("common.billing.plans.footer")}
      </p>
    </Dialog>
  );
}
