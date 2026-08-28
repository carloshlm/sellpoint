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
  const [pagando, setPagando] = useState<{ tenantId: string; tenantName: string } | null>(null);
  const [viendo, setViendo] = useState<{ tenantId: string; tenantName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin", "billing", "tenants"],
    queryFn: getAdminTenants,
    enabled: user?.isPlatformAdmin === true,
  });

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
          <p className="mb-3 text-muted-foreground text-sm">
            {Object.entries(data?.mrrByCurrency ?? {})
              .map(([currency, amount]) => `MRR ${currency}: $${amount}`)
              .join(" · ") || t("common.billing.admin.noMrr")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-2 py-1">{t("common.billing.admin.tenant")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.plan")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.status")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.dueAt")}</th>
                  <th className="px-2 py-1">{t("common.billing.admin.lastPayment")}</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {(data?.tenants ?? []).map((fila) => (
                  <tr key={fila.tenantId} className="border-b">
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
                          onClick={() =>
                            setPagando({ tenantId: fila.tenantId, tenantName: fila.tenantName })
                          }
                        >
                          {t("common.billing.admin.recordPayment")}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                paidAt: new Date(`${form.get("paidAt")}T12:00:00`).toISOString(),
                planCode: (form.get("planCode") as string) || undefined,
                amountReceived: (form.get("amountReceived") as string) || undefined,
                allowPartial: form.get("allowPartial") === "on" || undefined,
                notes: (form.get("notes") as string) || undefined,
              },
            });
          }}
        >
          {error ? <p className="text-destructive text-sm">{error}</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-cycle">{t("common.billing.admin.cycle")}</Label>
              <select id="pay-cycle" name="cycle" className="w-full rounded-md border p-2 text-sm">
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
              <input
                id="pay-date"
                name="paidAt"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="pay-plan">{t("common.billing.admin.planCode")}</Label>
              <select
                id="pay-plan"
                name="planCode"
                className="w-full rounded-md border p-2 text-sm"
              >
                <option value="">{t("common.billing.admin.keepPlan")}</option>
                {["basic", "pro", "plus", "premium"].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="pay-amount">{t("common.billing.admin.amountReceived")}</Label>
            <input
              id="pay-amount"
              name="amountReceived"
              inputMode="decimal"
              placeholder="499.00"
              className="w-full rounded-md border p-2 text-sm"
            />
          </div>
          <div>
            <Label htmlFor="pay-notes">{t("common.billing.admin.notes")}</Label>
            <input id="pay-notes" name="notes" className="w-full rounded-md border p-2 text-sm" />
          </div>
          {/*
            El seguro del cobro: sin esto, un monto por debajo del plan se
            rechaza en el server. Marcarlo es decidir aceptar el faltante, no
            saltarse una validación por descuido.
          */}
          <label className="flex items-start gap-2 text-sm" htmlFor="pay-partial">
            <input id="pay-partial" name="allowPartial" type="checkbox" className="mt-1" />
            <span>
              {t("common.billing.admin.allowPartial")}
              <span className="block text-muted-foreground text-xs">
                {t("common.billing.admin.allowPartialHint")}
              </span>
            </span>
          </label>
          <Button type="submit" disabled={registrar.isPending}>
            {t("common.billing.admin.confirmPayment")}
          </Button>
        </form>
      </Dialog>
    </div>
  );
}
