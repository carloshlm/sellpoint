import { localCalendarDate, scaledInteger } from "@sellpoint/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { TenantDetailDialog } from "@/components/billing/tenant-detail-dialog";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { getAdminTenants, recordPayment } from "@/lib/billing/api";
import { formatDeadline, formatInstant } from "@/lib/billing/dates";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/admin/billing")({
  component: AdminBillingPage,
});

function AdminBillingPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <AdminBilling />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F7-WEB-10 — el backoffice del dueño: la tabla de todos los negocios con su
 * plan, y el modal "Registrar pago" (LA operación semanal). El flag del
 * front solo decide si esta pantalla se pinta; la verdad son las cuatro
 * llaves del PlatformAdminGuard en cada request del server.
 */
function AdminBilling() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [pagando, setPagando] = useState<{
    tenantId: string;
    tenantName: string;
    planCode: string | null;
    /** La zona del NEGOCIO: es su calendario el que decide qué día es hoy. */
    timezone: string;
    charges: { planCode: string; monthly: string; yearly: string; currency: string }[];
  } | null>(null);
  const [viendo, setViendo] = useState<{ tenantId: string; tenantName: string } | null>(null);
  // El ciclo elegido decide qué cargo se muestra y se propone.
  const [ciclo, setCiclo] = useState<"monthly" | "yearly">("monthly");
  // El filtro de moneda: con clientes en tres mercados, la tabla completa
  // mezcla números que no se suman entre sí.
  const [moneda, setMoneda] = useState("");
  // El plan del cobro: el vigente del negocio, o el que se elija. De él
  // depende el precio, así que el autocálculo lo sigue.
  const [planPago, setPlanPago] = useState("");
  // Los dos lados de la cuenta, controlados: escribir uno completa el otro.
  const [recibido, setRecibido] = useState("");
  const [descuento, setDescuento] = useState("0");
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin", "billing", "tenants"],
    queryFn: getAdminTenants,
    enabled: user?.isPlatformAdmin === true,
  });

  /**
   * El precio del plan que se está cobrando. Si el negocio no tiene
   * suscripción, `planPago` es el del desplegable —el único que hay— y por
   * eso el autocálculo funciona igual que para uno con plan vigente.
   */
  const cargoVigente = (): string | undefined =>
    pagando?.charges.find((c) => c.planCode === planPago)?.[ciclo];

  const monedaVigente = (): string | undefined =>
    pagando?.charges.find((c) => c.planCode === planPago)?.currency;

  /**
   * Qué día es «hoy» para el NEGOCIO que se está cobrando.
   *
   * Con el día UTC, después de las 18:00 de México el formulario proponía
   * MAÑANA y el server lo rechazaba por futuro; con el del navegador fallaba
   * al revés si el negocio estaba en una zona más atrasada. El calendario que
   * manda es el del negocio (Carlos, 2026-09-04).
   */
  const hoyDelNegocio = localCalendarDate(pagando?.timezone ?? "UTC", new Date());

  /**
   * El otro lado de la cuenta. `recibido + descuento = cargo`, así que
   * escribir uno DETERMINA el otro y teclearlo dos veces sería pedirle al
   * dueño que haga la resta a mano.
   *
   * La aritmética va en CENTAVOS (`scaledInteger`) y no en flotantes: 499.10
   * menos 0.10 en IEEE-754 no da 499 exacto, y este número termina siendo
   * comparado por igualdad en el server.
   *
   * Nunca baja de cero: si alguien captura más de lo que se debe, el
   * complemento es 0 y el server rechaza el desajuste — que es exactamente
   * lo que tiene que pasar con un monto que no cuadra.
   */
  const complemento = (valor: string, cargo: string | undefined): string => {
    if (cargo === undefined) {
      return "";
    }
    const centavos = Math.max(0, scaledInteger(cargo, 2) - scaledInteger(valor || "0", 2));
    return `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, "0")}`;
  };

  const registrar = useMutation({
    mutationFn: ({
      tenantId,
      input,
    }: {
      tenantId: string;
      input: Parameters<typeof recordPayment>[1];
    }) => recordPayment(tenantId, input),
    onSuccess: () => {
      setPagando(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "billing", "tenants"] });
    },
    onError: (e: ApiError) => setError(e.message),
  });

  if (user && user.isPlatformAdmin !== true) {
    return <Navigate to="/dashboard" replace />;
  }

  // El dueño de la plataforma ve la fecha DE CADA NEGOCIO en la zona de ese
  // negocio: es su fecha de cobro, no la de quien mira la tabla.
  const vence = (iso: string | null, timeZone: string | null) =>
    formatDeadline(iso, timeZone ?? undefined, i18n.language);
  const fecha = (iso: string | null, timeZone: string | null) =>
    formatInstant(iso, timeZone ?? undefined, i18n.language);

  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="admin-billing">
        <CardHeader>
          <CardTitle>{t("common.billing.admin.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              {Object.entries(data?.mrrByCurrency ?? {})
                .filter(([currency]) => moneda === "" || currency === moneda)
                .map(([currency, amount]) => `MRR ${currency}: $${amount}`)
                .join(" · ") || t("common.billing.admin.noMrr")}
            </p>
            <div className="flex items-center gap-2">
              <Label htmlFor="filtro-moneda" className="text-sm">
                {t("common.billing.admin.filterCurrency")}
              </Label>
              {/* Las monedas que EXISTEN en la tabla, no un catálogo fijo:
                  ofrecer un filtro vacío es ofrecer un callejón sin salida. */}
              <select
                id="filtro-moneda"
                value={moneda}
                onChange={(event) => setMoneda(event.target.value)}
                className="rounded-md border p-1 text-sm"
              >
                <option value="">{t("common.billing.admin.allCurrencies")}</option>
                {[...new Set((data?.tenants ?? []).map((fila) => fila.currency))]
                  .sort()
                  .map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <ScrollableTable>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                  <th className="px-2 py-1">{t("common.billing.admin.tenant")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.country")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.currency")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.plan")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.status")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.dueAt")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.lastPayment")}</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {(data?.tenants ?? [])
                  .filter((fila) => moneda === "" || fila.currency === moneda)
                  .map((fila) => (
                    <tr key={fila.tenantId} className={`border-b ${TABLE_ROW_HOVER}`}>
                      <td className="px-2 py-1">
                        <button
                          type="button"
                          className="text-left underline-offset-2 hover:underline"
                          onClick={() =>
                            setViendo({ tenantId: fila.tenantId, tenantName: fila.tenantName })
                          }
                        >
                          {fila.tenantName}
                        </button>
                      </td>
                      <td className="px-2 py-1">{fila.country ?? "—"}</td>
                      <td className="px-2 py-1">{fila.currency}</td>
                      <td className="px-2 py-1">{fila.planName}</td>
                      <td className="px-2 py-1">{t(`common.billing.me.status.${fila.status}`)}</td>
                      <td className="px-2 py-1">{vence(fila.dueAt, fila.timezone)}</td>
                      <td className="px-2 py-1">{fecha(fila.lastPaymentAt, fila.timezone)}</td>
                      <td className="px-2 py-1">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setViendo({ tenantId: fila.tenantId, tenantName: fila.tenantName })
                            }
                          >
                            {t("common.billing.admin.detail")}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              // Sin suscripción no hay plan vigente: se propone
                              // el primer plan vendible para que el formulario
                              // arranque con una cuenta ya cuadrada.
                              const inicial =
                                fila.status === "none"
                                  ? (fila.charges[0]?.planCode ?? "")
                                  : fila.planCode;
                              setPagando({
                                tenantId: fila.tenantId,
                                tenantName: fila.tenantName,
                                planCode: fila.status === "none" ? null : fila.planCode,
                                timezone: fila.timezone,
                                charges: fila.charges,
                              });
                              setCiclo("monthly");
                              setPlanPago(inicial);
                              setRecibido(
                                fila.charges.find((c) => c.planCode === inicial)?.monthly ?? "",
                              );
                              setDescuento("0");
                            }}
                          >
                            {t("common.billing.admin.recordPayment")}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </ScrollableTable>
        </CardContent>
      </Card>

      <TenantDetailDialog
        tenantId={viendo?.tenantId ?? null}
        tenantName={viendo?.tenantName ?? ""}
        onClose={() => setViendo(null)}
      />

      <Dialog
        open={pagando !== null}
        onClose={() => setPagando(null)}
        title={t("common.billing.admin.paymentTitle", { tenant: pagando?.tenantName ?? "" })}
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!pagando) {
              return;
            }
            const form = new FormData(event.currentTarget);
            registrar.mutate({
              tenantId: pagando.tenantId,
              input: {
                billingCycle: form.get("cycle") as "monthly" | "yearly",
                method: form.get("method") as "transfer" | "cash" | "card" | "other" | "courtesy",
                // El DÍA tal cual: el server lo ancla al mediodía de la zona
                // del negocio. Armar un instante aquí lo corría de día.
                paidAt: String(form.get("paidAt")),
                // Igual al vigente = "mantener": no se manda nada.
                planCode: planPago === pagando.planCode ? undefined : planPago || undefined,
                amountReceived: recibido || "0",
                discountAmount: descuento || "0",
                notes: (form.get("notes") as string) || undefined,
              },
            });
          }}
        >
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-cycle">{t("common.billing.admin.cycle")}</Label>
              <select
                id="pay-cycle"
                name="cycle"
                value={ciclo}
                onChange={(event) => {
                  const nuevo = event.target.value as "monthly" | "yearly";
                  setCiclo(nuevo);
                  // Cambiar de ciclo cambia el precio: la cuenta se rehace
                  // entera en vez de quedar cuadrando contra el anterior.
                  setRecibido(pagando?.charges.find((c) => c.planCode === planPago)?.[nuevo] ?? "");
                  setDescuento("0");
                }}
                className="w-full rounded-md border p-2 text-sm"
              >
                <option value="monthly">{t("common.billing.plans.monthly")}</option>
                <option value="yearly">{t("common.billing.plans.yearly")}</option>
              </select>
            </div>
            <div>
              <Label htmlFor="pay-method">{t("common.billing.admin.method")}</Label>
              <select
                id="pay-method"
                name="method"
                className="w-full rounded-md border p-2 text-sm"
              >
                {["transfer", "cash", "card", "other", "courtesy"].map((m) => (
                  <option key={m} value={m}>
                    {t(`common.billing.me.method.${m}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="pay-date">{t("common.billing.admin.paidAt")}</Label>
              {/* `max` corta el error de dedo en el propio calendario; el
                  server lo rechaza igual (422 paid_at_in_future) porque una
                  validación de navegador no es una regla de negocio. */}
              <input
                id="pay-date"
                name="paidAt"
                type="date"
                required
                max={hoyDelNegocio}
                defaultValue={hoyDelNegocio}
                className="w-full rounded-md border p-2 text-sm"
              />
              <span className="text-muted-foreground text-xs">
                {t("common.billing.admin.paidAtHint")}
              </span>
            </div>
            <div>
              <Label htmlFor="pay-plan">{t("common.billing.admin.planCode")}</Label>
              {/*
                Solo los planes que ESE negocio puede pagar (los que tienen
                precio en su mercado), y "mantener el actual" únicamente si
                tiene uno: a un negocio sin suscripción no se le puede
                mantener nada, y el server exige el plan.
              */}
              <select
                id="pay-plan"
                name="planCode"
                value={planPago}
                onChange={(event) => {
                  const nuevo = event.target.value;
                  setPlanPago(nuevo);
                  // Otro plan, otro precio: la cuenta se rehace entera.
                  const precio = pagando?.charges.find((c) => c.planCode === nuevo)?.[ciclo] ?? "";
                  setRecibido(precio);
                  setDescuento("0");
                }}
                className="w-full rounded-md border p-2 text-sm"
              >
                {pagando?.planCode === null ? null : (
                  <option value={pagando?.planCode ?? ""}>
                    {t("common.billing.admin.keepPlan")}
                  </option>
                )}
                {(pagando?.charges ?? [])
                  .filter((c) => c.planCode !== pagando?.planCode)
                  .map((c) => (
                    <option key={c.planCode} value={c.planCode}>
                      {c.planCode}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          {/*
            El cargo a la vista: cuadrar la cuenta sin ver el número sería
            pedirle al dueño que saque calculadora.
          */}
          {cargoVigente() ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm" data-testid="expected-charge">
              {t("common.billing.admin.expectedCharge", {
                amount: `${cargoVigente()} ${monedaVigente()}`,
              })}
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-amount">{t("common.billing.admin.amountReceivedRequired")}</Label>
              <input
                id="pay-amount"
                name="amountReceived"
                inputMode="decimal"
                required
                value={recibido}
                onChange={(event) => {
                  setRecibido(event.target.value);
                  setDescuento(complemento(event.target.value, cargoVigente()));
                }}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pay-discount">{t("common.billing.admin.discountAmount")}</Label>
              <input
                id="pay-discount"
                name="discountAmount"
                inputMode="decimal"
                value={descuento}
                onChange={(event) => {
                  setDescuento(event.target.value);
                  setRecibido(complemento(event.target.value, cargoVigente()));
                }}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">{t("common.billing.admin.mustMatch")}</p>
          <div>
            <Label htmlFor="pay-notes">{t("common.billing.admin.notes")}</Label>
            <input id="pay-notes" name="notes" className="w-full rounded-md border p-2 text-sm" />
          </div>
          <Button type="submit" disabled={registrar.isPending}>
            {t("common.billing.admin.confirmPayment")}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
