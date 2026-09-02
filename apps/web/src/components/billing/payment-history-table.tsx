import { formatMoney } from "@sellpoint/shared";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import type { MyBilling } from "@/lib/billing/api";
import { formatDeadline, formatInstant } from "@/lib/billing/dates";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";

export type PaymentRow = MyBilling["payments"][number];

/**
 * El historial de pagos, UNA sola tabla para el backoffice y para «Mi plan»
 * del cliente (Carlos, 2026-09-02: «aplica el mismo estilo que en el
 * backoffice»). Un pago real va en verde, un descuento en su caja amarilla y
 * un pago anulado va tachado y en gris, con su «Ver» tan vivo como los demás.
 *
 * La tabla no cuenta todo de todos los pagos: cada fila tiene «Ver», y el
 * detalle de ESE pago aparece abajo, con el foco puesto para que la vista
 * baje sola. Las notas y el motivo de una anulación viven ahí, no debajo de
 * la tabla, que era donde se mezclaban las de todos.
 *
 * `renderAction` es lo único que difiere entre las dos pantallas: el
 * backoffice anula desde acá; el cliente solo mira.
 */
export function PaymentHistoryTable({
  payments,
  timeZone,
  locale,
  emptyText,
  renderAction,
}: {
  /** `undefined` mientras carga: la tabla se pinta vacía, sin el aviso de «sin pagos». */
  payments: PaymentRow[] | undefined;
  timeZone: string | undefined;
  locale: "es" | "en";
  emptyText: string;
  renderAction?: (pago: PaymentRow) => ReactNode;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const seleccionado = payments?.find((pago) => pago.id === selectedId) ?? null;

  // `vence` para el fin del período (límite abierto) y `fecha` para los
  // hechos puntuales: confundirlos muestra un día de más en la pantalla del cobro.
  const fecha = (iso: string | null) => formatInstant(iso, timeZone, locale);
  const vence = (iso: string | null) => formatDeadline(iso, timeZone, locale);
  const dinero = (monto: string, moneda: string) =>
    // biome-ignore lint/suspicious/noExplicitAny: la moneda viene del snapshot del pago
    formatMoney(Number(monto), moneda as any, locale);

  // Un pago anulado va TACHADO y en gris, celda por celda (Carlos, 2026-09-02):
  // si se apagara la fila entera, su «Ver» parecería deshabilitado — y no lo
  // está, porque el detalle de un anulado es justo donde vive el motivo.
  const celda = (pago: PaymentRow) =>
    `px-2 py-1 ${pago.status === "voided" ? "text-muted-foreground line-through" : ""}`;

  if (payments && payments.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyText}</p>;
  }

  return (
    <div className="space-y-3">
      <ScrollableTable>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className={`border-b ${TABLE_HEAD_ROW}`}>
              <th className="px-2 py-1">{t("common.billing.payment.paidAt")}</th>
              <th className="px-2 py-1">{t("common.billing.payment.plan")}</th>
              <th className="px-2 py-1">{t("common.billing.payment.method")}</th>
              <th className="px-2 py-1">{t("common.billing.payment.period")}</th>
              <th className="px-2 py-1 text-right">{t("common.billing.payment.discount")}</th>
              <th className="px-2 py-1 text-right">{t("common.billing.payment.amount")}</th>
              <th className="px-2 py-1" />
              {renderAction ? <th className="px-2 py-1" /> : null}
            </tr>
          </thead>
          <tbody>
            {(payments ?? []).map((pago) => (
              <tr
                key={pago.id}
                className={`border-b ${TABLE_ROW_HOVER} ${pago.status === "voided" ? "" : "bg-success-soft"}`}
              >
                <td className={celda(pago)}>{fecha(pago.paidAt)}</td>
                <td className={celda(pago)}>{pago.planCode}</td>
                <td className={celda(pago)}>{t(`common.billing.me.method.${pago.method}`)}</td>
                <td className={`${celda(pago)} whitespace-nowrap`}>
                  {fecha(pago.periodStart)} — {vence(pago.periodEnd)}
                </td>
                <td className={`${celda(pago)} text-right tabular-nums`}>
                  {Number(pago.discountAmount) > 0 ? (
                    <Badge variant="warning">{dinero(pago.discountAmount, pago.currency)}</Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${celda(pago)} text-right font-medium tabular-nums`}>
                  {dinero(pago.amount, pago.currency)}
                </td>
                <td className="px-2 py-1 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-pressed={pago.id === selectedId}
                    // El texto visible es «Ver»; el nombre accesible dice CUÁL pago,
                    // para que un lector de pantalla no oiga diez botones iguales.
                    aria-label={t("common.billing.payment.viewOf", { date: fecha(pago.paidAt) })}
                    onClick={() => setSelectedId(pago.id)}
                  >
                    {t("common.billing.payment.view")}
                  </Button>
                </td>
                {renderAction ? (
                  <td className="px-2 py-1 text-right">{renderAction(pago)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      {seleccionado ? (
        // `key` por pago: elegir otro «Ver» monta un panel nuevo, y con él
        // vuelven el desplazamiento y el foco.
        <PaymentDetail
          key={seleccionado.id}
          pago={seleccionado}
          fecha={fecha}
          vence={vence}
          dinero={dinero}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

function PaymentDetail({
  pago,
  fecha,
  vence,
  dinero,
  onClose,
}: {
  pago: PaymentRow;
  fecha: (iso: string | null) => string;
  vence: (iso: string | null) => string;
  dinero: (monto: string, moneda: string) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // `block: "nearest"`: el panel está justo debajo de la tabla; basta con
  // que entre en la vista, sin centrarlo y sacar la tabla de pantalla.
  const ref = useScrollIntoView<HTMLDivElement>({ block: "nearest" });
  const anulado = pago.status === "voided";

  const campo = (etiqueta: string, valor: ReactNode, ancho = false) => (
    <div className={ancho ? "col-span-full" : undefined}>
      <dt className="text-muted-foreground text-xs">{etiqueta}</dt>
      <dd className="text-sm">{valor}</dd>
    </div>
  );

  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-testid="payment-detail"
      className="space-y-3 rounded-md border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-sm">{t("common.billing.payment.detailTitle")}</p>
        <Badge variant={anulado ? "default" : "success"}>
          {t(anulado ? "common.billing.payment.voided" : "common.billing.payment.recorded")}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {campo(t("common.billing.payment.paidAt"), fecha(pago.paidAt))}
        {campo(t("common.billing.payment.plan"), pago.planCode)}
        {campo(
          t("common.billing.payment.cycle"),
          t(`common.billing.payment.cycles.${pago.billingCycle}`, {
            defaultValue: pago.billingCycle,
          }),
        )}
        {campo(t("common.billing.payment.method"), t(`common.billing.me.method.${pago.method}`))}
        {campo(
          t("common.billing.payment.period"),
          `${fecha(pago.periodStart)} — ${vence(pago.periodEnd)}`,
        )}
        {campo(t("common.billing.payment.currency"), pago.currency)}
        {campo(t("common.billing.payment.gross"), dinero(pago.grossAmount, pago.currency))}
        {campo(
          t("common.billing.payment.discount"),
          Number(pago.discountAmount) > 0 ? (
            <Badge variant="warning">{dinero(pago.discountAmount, pago.currency)}</Badge>
          ) : (
            "—"
          ),
        )}
        {campo(
          t("common.billing.payment.amount"),
          <span className="font-medium tabular-nums">{dinero(pago.amount, pago.currency)}</span>,
        )}
        {campo(t("common.billing.payment.notes"), pago.notes ?? "—", true)}
        {campo(t("common.billing.payment.createdAt"), fecha(pago.createdAt))}
        {anulado ? campo(t("common.billing.payment.voidedAt"), fecha(pago.voidedAt)) : null}
        {anulado
          ? campo(t("common.billing.payment.voidReason"), pago.voidReason ?? "—", true)
          : null}
      </dl>
      <Button type="button" size="sm" variant="outline" onClick={onClose}>
        {t("common.billing.payment.close")}
      </Button>
    </div>
  );
}
