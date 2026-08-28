import { formatMoney } from "@sellpoint/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { getPlans, type PublicPlan } from "@/lib/billing/api";
import { usePlan } from "@/lib/billing/use-plan";
import { useBillingStore } from "@/stores/billing.store";

/**
 * F7-WEB-04 — la vitrina de planes. Se abre desde el PlanGate (free tier),
 * el interceptor 402 y los candados del sidebar. Los precios llegan YA
 * resueltos por el país del negocio: el front solo formatea.
 *
 * Sin botón de pago: el cobro de esta fase es MANUAL — el CTA invita a
 * contactar y el dueño de la plataforma registra el pago en su backoffice.
 *
 * ── Por qué la lista completa y no solo lo incluido ─────────────────────
 *
 * Carlos (2026-08-29): «quiero que sea más entendible al usuario final qué
 * incluye cada plan». Quien elige plan no está leyendo una tarjeta: está
 * COMPARANDO tres. Por eso las once capacidades aparecen SIEMPRE en el mismo
 * orden en las tres columnas, con palomita o guion — así la vista salta de
 * una tarjeta a otra por la misma línea y la diferencia se ve sola. Mostrar
 * únicamente lo incluido acorta las tarjetas y destruye justo eso: con
 * listas de distinto largo, comparar exige leerlas enteras.
 *
 * Y los nombres son de NEGOCIO, no del modelo: nadie contrata
 * "compositions", contrata "presentaciones y recetas".
 */

/**
 * El orden es deliberado: de lo que todos tienen a lo que solo trae el plan
 * más alto. Leído de arriba abajo, cuenta la historia de cuánto crece el
 * sistema con cada escalón.
 */
const CAPACIDADES = [
  "pos",
  "stockControl",
  "movements",
  "transfers",
  "quotes",
  "compositions",
  "lots",
  "custom_fields",
  "custom_roles",
  "reports",
  "reports_export",
] as const;

type Capacidad = (typeof CAPACIDADES)[number];

/** `stockControl` es columna dura; el resto vive en la matriz `features`. */
function incluye(plan: PublicPlan, capacidad: Capacidad): boolean {
  if (capacidad === "stockControl") {
    return plan.stockControl;
  }
  return plan.features[capacidad] === true;
}

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
            data-testid={`plan-${plan.code}`}
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

            {/* Los límites primero: son la pregunta que todos hacen. */}
            <ul className="mb-3 space-y-1 border-b pb-3 font-medium text-sm">
              <li>
                {plan.maxUsers === null
                  ? `${t("common.billing.plans.unlimited")} · ${t("common.billing.plans.users", { count: 2 })}`
                  : t("common.billing.plans.users", { count: plan.maxUsers })}
              </li>
              <li>
                {plan.maxWarehouses === null
                  ? `${t("common.billing.plans.unlimited")} · ${t("common.billing.plans.warehouses", { count: 2 })}`
                  : t("common.billing.plans.warehouses", { count: plan.maxWarehouses })}
              </li>
            </ul>

            {/*
              Las once capacidades SIEMPRE, en el mismo orden en cada tarjeta:
              es lo que permite comparar de un vistazo en vez de leer tres
              listas de distinto largo. El `aria-hidden` en el símbolo y el
              texto "No incluido" en el título dejan la misma información
              disponible para quien no ve el color ni la palomita.
            */}
            <ul className="mb-4 space-y-1 text-sm">
              {CAPACIDADES.map((capacidad) => {
                const tiene = incluye(plan, capacidad);
                const nombre = t(`common.billing.capabilities.${capacidad}`);
                return (
                  <li
                    key={capacidad}
                    className={`flex gap-2 ${tiene ? "" : "text-muted-foreground"}`}
                    title={tiene ? nombre : t("common.billing.plans.notIncluded", { item: nombre })}
                  >
                    <span aria-hidden="true" className={tiene ? "text-primary" : ""}>
                      {tiene ? "✓" : "—"}
                    </span>
                    <span className={tiene ? "" : "line-through decoration-muted-foreground/40"}>
                      {nombre}
                    </span>
                  </li>
                );
              })}
              {/*
                Que Basic pueda vender sin existencias es una VENTAJA para el
                mostrador que no lleva inventario, no un defecto. Dicho así
                para que quien lo lea entienda por qué le puede convenir.
              */}
              {plan.stockControl ? null : (
                <li className="flex gap-2 pt-1 text-muted-foreground text-xs">
                  <span aria-hidden="true">★</span>
                  <span>{t("common.billing.plans.sellWithoutStock")}</span>
                </li>
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
