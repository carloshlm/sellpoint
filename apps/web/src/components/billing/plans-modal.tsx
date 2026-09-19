import {
  formatMoney,
  PLAN_LINES,
  type PlanCode,
  type PlanLine,
  planIncludesModule,
} from "@sellpoint/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { getPlans, type PublicPlan } from "@/lib/billing/api";
import { usePlan } from "@/lib/billing/use-plan";
import { MODULE_NAV } from "@/lib/modules/nav";
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
 * La lista comercial —qué líneas, en qué orden— vive en `@sellpoint/shared`
 * (`PLAN_LINES`, F11-SITE-PLANS-01): la leen esta vitrina Y el sitio público,
 * para que nunca anuncien cosas distintas. Aquí solo se decide si el plan que
 * llegó del API incluye cada línea: esa respuesta es la verdad, no el
 * `minPlan` de la lista.
 */
type Linea = PlanLine;
const LINEAS = PLAN_LINES;

/**
 * Los módulos de plan se derivan de `MODULE_MIN_PLAN` y no de `plan.features`
 * (F9-PLANMOD-06): la matriz es un `strictObject` sin defaults y un módulo no
 * es un feature. Los pactados (`minPlan: null`) no se venden en la vitrina:
 * se acuerdan uno a uno desde el backoffice — es la línea «a la medida».
 */
function incluye(plan: PublicPlan, linea: Linea): boolean {
  switch (linea.kind) {
    case "always":
      return true;
    case "premium":
      return plan.code === "premium";
    case "module":
      return planIncludesModule(plan.code as PlanCode, linea.key);
    default:
      return linea.key === "stockControl" ? plan.stockControl : plan.features[linea.key] === true;
  }
}

function nombreDe(linea: Linea, t: (key: string) => string): string {
  return linea.kind === "module"
    ? t(MODULE_NAV[linea.key].labelKey)
    : t(`common.billing.capabilities.${linea.key}`);
}

export function PlansModal() {
  const { t, i18n } = useTranslation();
  const open = useBillingStore((state) => state.plansModalOpen);
  const close = useBillingStore((state) => state.closePlansModal);
  const navigate = useNavigate();

  /**
   * F7-CONTACT-02 — el modal no cobra el plan, así que su única salida útil es
   * dejar a la persona ESCRIBIENDO. Cierra, va a «Mi plan» y manda el plan en
   * la URL: allá el mensaje llega escrito y el cursor puesto. Sin plan (desde
   * el pie) el formulario queda vacío, solo enfocado.
   */
  const escribirSobre = (interes?: string) => {
    close();
    navigate({
      to: "/settings/billing",
      // El `validateSearch` de la ruta es la aduana: si el código no existe
      // en el catálogo, allá se ignora y el formulario queda vacío.
      search: interes ? { interes: interes as PlanCode } : {},
    });
  };
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
            {/* La descripción se guarda en la base en español; en pantalla
                manda el idioma del usuario, con lo de la base como respaldo
                para un plan que el catálogo del web no conozca. */}
            {plan.description || plan.code ? (
              <p className="mt-1 text-muted-foreground text-sm">
                {t(`common.billing.plans.descriptions.${plan.code}`, {
                  defaultValue: plan.description ?? "",
                })}
              </p>
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
              {/*
                NULL es "sin límite" y tiene su propia frase. Componerla como
                "Sin límite · {{count}} usuarios" produjo «Sin límite · 2
                usuarios» en Premium — un absurdo que el test no vio porque
                afirmaba la subcadena "Sin límite", que era cierta.
              */}
              <li>
                {plan.maxUsers === null
                  ? t("common.billing.plans.unlimitedUsers")
                  : t("common.billing.plans.users", { count: plan.maxUsers })}
              </li>
              <li>
                {plan.maxWarehouses === null
                  ? t("common.billing.plans.unlimitedWarehouses")
                  : t("common.billing.plans.warehouses", { count: plan.maxWarehouses })}
              </li>
            </ul>

            {/*
              Las mismas líneas SIEMPRE, en el mismo orden en cada tarjeta: es
              lo que permite comparar de un vistazo en vez de leer tres listas
              de distinto largo. El `aria-hidden` en el símbolo y el texto "No
              incluido" en el título dejan la misma información disponible
              para quien no ve el color ni la palomita.
            */}
            <ul className="mb-4 space-y-1 text-sm">
              {LINEAS.map((linea) => {
                const tiene = incluye(plan, linea);
                const nombre = nombreDe(linea, t);
                return (
                  <li
                    key={linea.key}
                    className={`flex gap-2 ${tiene ? "" : "text-muted-foreground"}`}
                    title={tiene ? nombre : t("common.billing.plans.notIncluded", { item: nombre })}
                    data-testid={`plan-${plan.code}-${linea.kind === "module" ? "module-" : ""}${linea.key}`}
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
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => escribirSobre(plan.code)}
                >
                  {t("common.billing.plans.interested")}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center text-muted-foreground text-sm">
        {t("common.billing.plans.footer")}{" "}
        <button
          type="button"
          className="font-medium text-primary underline underline-offset-2"
          onClick={() => escribirSobre()}
        >
          {t("common.billing.plans.writeUs")}
        </button>
      </p>
    </Dialog>
  );
}
