import { PLAN_CODES, type PlanCode, planIncludesModule } from "@sellpoint/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { PaymentHistoryTable } from "@/components/billing/payment-history-table";
import { TextAreaField } from "@/components/form/text-area-field";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SuccessNotice } from "@/components/ui/success-notice";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import { getMyBilling, requestPlan } from "@/lib/billing/api";
import { formatDeadline } from "@/lib/billing/dates";
import { usePlan } from "@/lib/billing/use-plan";
import { MODULE_NAV } from "@/lib/modules/nav";
import { useAuthStore } from "@/stores/auth.store";
import { useBillingStore } from "@/stores/billing.store";

export const Route = createFileRoute("/settings/billing")({
  /**
   * F7-CONTACT-02: `?interes=pro` llega desde «Me interesa» del modal de
   * planes. Se valida contra el catálogo real —lo que viene en la URL lo puede
   * escribir cualquiera— y sin plan válido no pasa nada: el formulario queda
   * vacío, como siempre.
   */
  validateSearch: z.object({
    // `.catch`: un código inventado en la URL se ignora, no tumba la
    // pantalla. Lo que llega por la barra de direcciones lo escribe
    // cualquiera.
    interes: z.enum(PLAN_CODES).optional().catch(undefined),
  }),
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
  const { subscription, daysLeft, planCode, modules } = usePlan();
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

      {/*
        F9-PLANMOD-06 — los módulos que el negocio tiene, con su origen: los
        que el plan contratado INCLUYE (`plan-modules.ts`) y los pactados a la
        medida desde el backoffice. Sin módulos la tarjeta no existe: un
        negocio Free no tiene nada que leer aquí.
      */}
      {modules.length > 0 ? (
        <Card data-testid="my-modules">
          <CardHeader>
            <CardTitle>{t("common.billing.me.modules.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {modules.map((key) => {
                const incluido = planCode !== null && planIncludesModule(planCode, key);
                return (
                  <li
                    key={key}
                    className="flex flex-wrap items-baseline gap-2"
                    data-testid={`my-module-${key}`}
                  >
                    <span className="font-medium">{t(MODULE_NAV[key].labelKey)}</span>
                    <span className="text-muted-foreground text-xs">
                      {incluido
                        ? t("common.billing.me.modules.included", {
                            plan: subscription?.planName ?? planCode,
                          })
                        : t("common.billing.me.modules.custom")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}

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

      <PlanContactCard />
    </div>
  );
}

/** El nombre como lo ve el cliente, no el código de la base. */
const PLAN_NAMES: Record<PlanCode, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  plus: "Plus",
  premium: "Premium",
};

const MENSAJE_MIN = 10;
const MENSAJE_MAX = 1000;

/**
 * F7-CONTACT (Carlos, 2026-09-05) — «Escríbenos para activar tu plan». El
 * mensaje llega a los administradores de la plataforma con el negocio, el
 * nombre y el correo de quien escribe; al terminar, el agradecimiento y la
 * promesa de contacto quedan en pantalla (y en el correo del negocio).
 */
function PlanContactCard() {
  const { t } = useTranslation();
  const { interes } = Route.useSearch();
  const campoRef = useRef<HTMLTextAreaElement>(null);
  const [mensaje, setMensaje] = useState("");

  /**
   * Quien llegó por «Me interesa» ya dijo cuál quiere con el clic: pedirle que
   * lo escriba otra vez sería cobrarle dos veces la misma información. El
   * mensaje viene puesto y editable — es un punto de partida, no un candado.
   *
   * Va en un efecto y no en el estado inicial porque el caso normal es LLEGAR
   * ESTANDO: quien ya está en «Mi plan» abre el modal, elige un plan y vuelve
   * acá sin que el componente se vuelva a montar. Con un `useState(() => …)`
   * el mensaje quedaba vacío justo en el camino más transitado — se vio en el
   * navegador, no en los tests.
   *
   * El foco va al campo, no al principio de la página: la persona viene a
   * escribir. Solo cuando vino por un plan; robar el foco sin que nadie lo
   * haya pedido es de mala educación.
   */
  useEffect(() => {
    if (!interes) return;
    setMensaje(t("common.billing.me.contact.prefill", { plan: PLAN_NAMES[interes] }));
    campoRef.current?.focus();
  }, [interes, t]);

  const [error, setError] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const enviar = useMutation<{ sent: true }, ApiError, string>({
    mutationFn: (texto) => requestPlan(texto),
  });
  const k = (sufijo: string) => t(`common.billing.me.contact.${sufijo}`);
  const valido = mensaje.trim().length >= MENSAJE_MIN && mensaje.trim().length <= MENSAJE_MAX;

  return (
    <Card data-testid="plan-contact">
      <CardHeader>
        <CardTitle>{k("title")}</CardTitle>
        <CardDescription>{k("intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex max-w-2xl flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            setEnviado(false);
            enviar.mutate(mensaje.trim(), {
              onSuccess: () => {
                setEnviado(true);
                setMensaje("");
              },
              onError: (apiError) => setError(apiError.message || k("failed")),
            });
          }}
        >
          <TextAreaField
            ref={campoRef}
            label={k("message")}
            hint={k("hint")}
            rows={4}
            maxLength={MENSAJE_MAX}
            value={mensaje}
            disabled={enviar.isPending}
            onChange={(event) => setMensaje(event.target.value)}
          />
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
            >
              {error}
            </p>
          )}
          {enviado && <SuccessNotice>{k("sent")}</SuccessNotice>}
          <div>
            <Button type="submit" disabled={!valido || enviar.isPending}>
              {enviar.isPending ? t("common.form.submitting") : k("send")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
