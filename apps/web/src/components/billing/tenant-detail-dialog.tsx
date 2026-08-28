import { formatMoney } from "@sellpoint/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import { getAdminTenantDetail, voidPayment } from "@/lib/billing/api";

/**
 * El expediente de UN negocio dentro del backoffice: su suscripción, su
 * cupón vigente y **el historial de pagos** — que era lo que faltaba
 * (Carlos, 2026-08-29: «tampoco se ve el historial de pagos por cada
 * cliente»).
 *
 * Un backoffice de cobros sin historial obliga a confiar en la memoria para
 * responder "¿este ya me pagó agosto?". El historial ES la respuesta, y por
 * eso trae también el período que cubrió cada pago y sus notas, que es donde
 * queda dicho cuando el cliente transfirió una cifra distinta.
 *
 * Anular vive acá y no en la tabla: es una corrección sobre UN pago
 * concreto, y solo se puede elegir bien teniéndolos todos a la vista.
 */
export function TenantDetailDialog({
  tenantId,
  tenantName,
  onClose,
}: {
  tenantId: string | null;
  tenantName: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [anulando, setAnulando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["admin", "billing", "tenant", tenantId],
    queryFn: () => getAdminTenantDetail(tenantId as string),
    enabled: tenantId !== null,
  });

  const anular = useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      voidPayment(tenantId as string, paymentId, reason),
    onSuccess: () => {
      setAnulando(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const locale = i18n.language === "en" ? "en" : "es";
  const fecha = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "es-MX") : "—";

  return (
    <Dialog
      open={tenantId !== null}
      onClose={onClose}
      title={t("common.billing.admin.detailTitle", { tenant: tenantName })}
    >
      <div className="space-y-4" data-testid="tenant-detail">
        <div className="space-y-1 text-sm">
          <p>
            <span className="font-medium">{data?.subscription.plan.name ?? "—"}</span>
            {" · "}
            {t(`common.billing.me.status.${data?.subscription.status ?? "none"}`)}
          </p>
          {data?.subscription.dueAt ? (
            <p>{t("common.billing.me.nextDue", { date: fecha(data.subscription.dueAt) })}</p>
          ) : null}
          {data?.activeDiscount ? (
            <p>
              {t("common.billing.admin.discount", {
                detail:
                  data.activeDiscount.kind === "free"
                    ? t("common.billing.me.method.courtesy")
                    : `-$${data.activeDiscount.amount ?? ""} (${data.activeDiscount.appliedPeriods}/${
                        data.activeDiscount.maxPeriods ?? "∞"
                      })`,
              })}
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="mb-2 font-medium text-sm">{t("common.billing.admin.history")}</h3>
          {data && data.payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("common.billing.admin.noPayments")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-1">{t("common.billing.admin.paidAt")}</th>
                    <th className="px-2 py-1">{t("common.billing.admin.plan")}</th>
                    <th className="px-2 py-1">{t("common.billing.admin.method")}</th>
                    <th className="px-2 py-1">{t("common.billing.admin.period")}</th>
                    <th className="px-2 py-1 text-right">{t("common.billing.admin.amount")}</th>
                    <th className="px-2 py-1" />
                  </tr>
                </thead>
                <tbody>
                  {(data?.payments ?? []).map((pago) => (
                    <tr
                      key={pago.id}
                      className={`border-b ${pago.status === "voided" ? "text-muted-foreground line-through" : ""}`}
                    >
                      <td className="px-2 py-1">{fecha(pago.paidAt)}</td>
                      <td className="px-2 py-1">{pago.planCode}</td>
                      <td className="px-2 py-1">{t(`common.billing.me.method.${pago.method}`)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">
                        {fecha(pago.periodStart)} — {fecha(pago.periodEnd)}
                      </td>
                      <td className="px-2 py-1 text-right font-medium tabular-nums">
                        {formatMoney(
                          Number(pago.amount),
                          // biome-ignore lint/suspicious/noExplicitAny: la moneda viene del snapshot del pago
                          pago.currency as any,
                          locale,
                        )}
                      </td>
                      <td className="px-2 py-1 text-right">
                        {pago.status === "voided" ? (
                          <span className="text-xs">{t("common.billing.admin.voided")}</span>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => setAnulando(pago.id)}
                          >
                            {t("common.billing.admin.void")}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* Las notas explican los cobros que no cuadran con la tarifa. */}
          {(data?.payments ?? []).some((p) => p.notes) ? (
            <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
              {(data?.payments ?? [])
                .filter((p) => p.notes)
                .map((p) => (
                  <li key={`nota-${p.id}`}>
                    {fecha(p.paidAt)}: {p.notes}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>

        {anulando !== null ? (
          <form
            className="space-y-2 rounded-md border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              const reason = String(new FormData(event.currentTarget).get("reason") ?? "");
              anular.mutate({ paymentId: anulando, reason });
            }}
          >
            <p className="font-medium text-sm">{t("common.billing.admin.voidTitle")}</p>
            {error ? <p className="text-destructive text-sm">{error}</p> : null}
            <div>
              <Label htmlFor="void-reason">{t("common.billing.admin.voidReason")}</Label>
              <input
                id="void-reason"
                name="reason"
                required
                minLength={1}
                className="w-full rounded-md border p-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={anular.isPending}>
                {t("common.billing.admin.voidConfirm")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setAnulando(null);
                  setError(null);
                }}
              >
                {t("common.billing.admin.close")}
              </Button>
            </div>
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}
