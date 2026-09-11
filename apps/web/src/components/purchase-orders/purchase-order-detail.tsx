import { type Currency, formatMoney } from "@sellpoint/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateField } from "@/components/form/date-field";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { PurchaseOrderLinesTable } from "@/components/purchase-orders/purchase-order-lines-table";
import { SupplierPicker } from "@/components/suppliers/supplier-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { businessToday, formatCalendarDate } from "@/lib/inventory/format-date";
import type { PurchaseOrder, UpdatePurchaseOrderInput } from "@/lib/purchase-orders/api";
import { printPurchaseOrder } from "@/lib/purchase-orders/api";
import {
  useCancelPurchaseOrder,
  useClosePurchaseOrder,
  useCreatePurchaseFromReceipts,
  useCreatePurchaseReceipt,
  useIssuePurchaseOrder,
  useUpdatePurchaseOrder,
} from "@/lib/purchase-orders/hooks";
import { useAutosave } from "@/lib/use-autosave";
import { useAuthStore } from "@/stores/auth.store";

const VARIANTE: Record<PurchaseOrder["status"], "default" | "success" | "warning" | "destructive"> =
  {
    draft: "default",
    open: "warning",
    partially_received: "warning",
    received: "success",
    closed: "default",
    canceled: "destructive",
  };

/**
 * F9-PO-12/13 — la pantalla de la orden: el compromiso con el proveedor y,
 * emitida, el tablero de lo que va llegando.
 *
 * La CABECERA se autoguarda con `useAutosave` (un PATCH por pausa con todo lo
 * tecleado). En borrador se edita todo; emitida, solo la fecha esperada, la
 * referencia, las condiciones y las notas — promesas y anotaciones, nada que
 * mueva el dinero acordado. Las LÍNEAS van en bloque.
 *
 * De aquí salen las dos acciones que hacen el three-way match: «Registrar
 * recepción» (lo que llegó al andén) y «Registrar compra de lo recibido» (la
 * factura sobre lo que llegó). La mercancía entra al inventario por la
 * entrada de esa compra, como siempre.
 */
export function PurchaseOrderDetail({ order }: { order: PurchaseOrder }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const hoy = businessToday(useAuthStore((s) => s.user?.tenant.timezone));

  const borrador = order.status === "draft";
  const viva = order.status === "open" || order.status === "partially_received";
  const cerrable = viva || order.status === "received";
  const terminada = order.status === "closed" || order.status === "canceled";
  const puedeEditar = has("purchases:manage") && canWrite;
  const puedeAnular =
    has("purchases:cancel") && canWrite && (order.status === "draft" || order.status === "open");
  const hayPendiente = order.lines.some((l) => !l.closedShort && Number(l.pending) > 0);
  const sinFactura = order.receipts.filter(
    (r) => r.status === "confirmed" && (r.purchase === null || r.purchase.status === "canceled"),
  );

  const [supplierId, setSupplierId] = useState(order.supplierId);
  const [orderDate, setOrderDate] = useState(order.orderDate);
  const [expectedDate, setExpectedDate] = useState(order.expectedDate ?? "");
  const [supplierReference, setSupplierReference] = useState(order.supplierReference ?? "");
  const [paymentTerms, setPaymentTerms] = useState(order.paymentTerms ?? "");
  const [taxMode, setTaxMode] = useState(order.taxMode);
  const [notes, setNotes] = useState(order.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [emitiendo, setEmitiendo] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [facturando, setFacturando] = useState(false);
  const [elegidas, setElegidas] = useState<string[]>([]);

  const guardar = useUpdatePurchaseOrder();
  const emitir = useIssuePurchaseOrder();
  const cerrar = useClosePurchaseOrder();
  const anular = useCancelPurchaseOrder();
  const recibir = useCreatePurchaseReceipt();
  const facturar = useCreatePurchaseFromReceipts();

  const onError = (apiError: { message: string }) => setError(apiError.message);
  const autoguardar = useAutosave<UpdatePurchaseOrderInput>((cambios) => {
    setError(null);
    guardar.mutate({ id: order.id, input: cambios }, { onError });
  });

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    );
  const cortas = order.lines.filter((l) => !l.closedShort && Number(l.pending) > 0).length;

  return (
    <div className="flex flex-col gap-4" data-testid="purchase-order-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-xl">
            {t("purchaseOrders.detail.title", { folio: order.folio })}
          </h1>
          <Badge variant={VARIANTE[order.status]}>
            {t(`purchaseOrders.status.${order.status}`)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {!borrador && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void printPurchaseOrder(order.id, order.folio)}
            >
              {t("purchaseOrders.detail.print")}
            </Button>
          )}
          {borrador && puedeEditar && (
            <Button type="button" onClick={() => setEmitiendo(true)}>
              {t("purchaseOrders.detail.issue")}
            </Button>
          )}
          {viva && puedeEditar && hayPendiente && (
            <Button
              type="button"
              disabled={recibir.isPending}
              onClick={() => {
                setError(null);
                recibir.mutate(order.id, {
                  onSuccess: (recepcion) =>
                    navigate({
                      to: "/purchase-orders/$orderId/receipts/$receiptId",
                      params: { orderId: order.id, receiptId: recepcion.id },
                    }),
                  onError,
                });
              }}
            >
              {t("purchaseOrders.receipts.new")}
            </Button>
          )}
          {puedeEditar && sinFactura.length > 0 && (
            <Button
              type="button"
              data-testid="register-purchase"
              onClick={() => {
                setElegidas(sinFactura.map((r) => r.id));
                setFacturando(true);
              }}
            >
              {t("purchaseOrders.receipts.registerPurchase")}
            </Button>
          )}
          {cerrable && puedeEditar && (
            <Button type="button" variant="outline" onClick={() => setCerrando(true)}>
              {t("purchaseOrders.detail.close")}
            </Button>
          )}
          {puedeAnular && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setMotivo("");
                setAnulando(true);
              }}
            >
              {t("purchaseOrders.detail.cancel")}
            </Button>
          )}
        </div>
      </div>

      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {order.status === "canceled" && order.canceledAt !== null && (
        <p
          role="status"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {t("purchaseOrders.detail.canceledOn", {
            date: fecha(order.canceledAt),
            reason: order.cancelReason ?? "",
          })}
        </p>
      )}
      {order.status === "closed" && order.closedAt !== null && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("purchaseOrders.detail.closedOn", { date: fecha(order.closedAt) })}
        </p>
      )}
      {(viva || order.status === "received") && (
        <p className="text-muted-foreground text-sm">{t("purchaseOrders.detail.issuedNote")}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("purchaseOrders.detail.supplier")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {borrador ? (
              <SupplierPicker
                value={supplierId}
                onChange={(proveedor) => {
                  if (proveedor === null) return;
                  setSupplierId(proveedor.id);
                  autoguardar({ supplierId: proveedor.id });
                }}
                label={t("purchaseOrders.detail.supplier")}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {t("purchaseOrders.detail.supplier")}
                </span>
                <span className="font-medium">{order.supplierName}</span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {t("purchaseOrders.detail.warehouse")}
              </span>
              <span className="font-medium">{order.warehouseName}</span>
            </div>
            <DateField
              label={t("purchaseOrders.detail.date")}
              max={hoy}
              value={orderDate}
              disabled={!borrador || !puedeEditar}
              onChange={(event) => {
                setOrderDate(event.target.value);
                autoguardar({ orderDate: event.target.value });
              }}
            />
            {/* La ÚNICA fecha sin tope: es la promesa del proveedor. */}
            <DateField
              label={t("purchaseOrders.detail.expectedDate")}
              hint={t("purchaseOrders.detail.expectedHint")}
              value={expectedDate}
              disabled={terminada || !puedeEditar}
              onChange={(event) => {
                setExpectedDate(event.target.value);
                autoguardar({ expectedDate: event.target.value || null });
              }}
            />
            <TextField
              label={t("purchaseOrders.detail.reference")}
              value={supplierReference}
              disabled={terminada || !puedeEditar}
              onChange={(event) => {
                setSupplierReference(event.target.value);
                autoguardar({ supplierReference: event.target.value || null });
              }}
            />
            <TextField
              label={t("purchaseOrders.detail.terms")}
              value={paymentTerms}
              disabled={terminada || !puedeEditar}
              onChange={(event) => {
                setPaymentTerms(event.target.value);
                autoguardar({ paymentTerms: event.target.value || null });
              }}
            />
            <SelectField
              label={t("purchaseOrders.detail.taxMode")}
              value={taxMode}
              disabled={!borrador || !puedeEditar}
              options={[
                { value: "excluded", label: t("purchaseOrders.detail.taxModeExcluded") },
                { value: "included", label: t("purchaseOrders.detail.taxModeIncluded") },
              ]}
              onChange={(event) => {
                const modo = event.target.value as PurchaseOrder["taxMode"];
                setTaxMode(modo);
                autoguardar({ taxMode: modo });
              }}
            />
            <TextField
              label={t("purchaseOrders.detail.notes")}
              className="sm:col-span-2"
              value={notes}
              disabled={terminada || !puedeEditar}
              onChange={(event) => {
                setNotes(event.target.value);
                autoguardar({ notes: event.target.value || null });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <PurchaseOrderLinesTable order={order} />

      <section
        className="flex flex-col items-end gap-1 text-sm"
        data-testid="purchase-order-totals"
      >
        <Total label={t("purchaseOrders.totals.subtotal")} value={dinero(order.subtotal)} />
        {Number(order.discount) > 0 && (
          <Total label={t("purchaseOrders.totals.discount")} value={`−${dinero(order.discount)}`} />
        )}
        {order.taxes.map((tax) => (
          <Total
            key={tax.code}
            label={`${tax.name} (${tax.rate}%) · ${t("purchaseOrders.totals.estimated")}`}
            value={dinero(tax.amount)}
          />
        ))}
        <Total
          label={t("purchaseOrders.totals.total")}
          value={dinero(order.total)}
          destacado
          testId="purchase-order-total"
        />
      </section>

      <section className="flex flex-col gap-2" data-testid="purchase-order-receipts">
        <h2 className="font-medium">{t("purchaseOrders.receipts.title")}</h2>
        {order.receipts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("purchaseOrders.receipts.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {order.receipts.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-2"
                data-testid={`receipt-${r.id}`}
              >
                <Link
                  to="/purchase-orders/$orderId/receipts/$receiptId"
                  params={{ orderId: order.id, receiptId: r.id }}
                  className="font-mono text-primary underline-offset-2 hover:underline"
                >
                  {r.folio}
                </Link>
                <span>{formatCalendarDate(r.receivedDate, i18n.language)}</span>
                {r.packingSlip !== null && (
                  <span className="text-muted-foreground">
                    {t("purchaseOrders.receipts.packingSlip")}: {r.packingSlip}
                  </span>
                )}
                <Badge
                  variant={
                    r.status === "confirmed"
                      ? "success"
                      : r.status === "canceled"
                        ? "destructive"
                        : "default"
                  }
                >
                  {t(`purchaseOrders.receiptStatus.${r.status}`)}
                </Badge>
                {r.status === "confirmed" && (
                  <span className="text-muted-foreground text-xs">
                    {r.purchase !== null && r.purchase.status !== "canceled"
                      ? t("purchaseOrders.receipts.invoicedIn", { folio: r.purchase.folio })
                      : t("purchaseOrders.receipts.notInvoiced")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="purchase-order-purchases">
        <h2 className="font-medium">{t("purchaseOrders.purchases.title")}</h2>
        {order.purchases.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("purchaseOrders.purchases.empty")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {order.purchases.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <Link
                  to="/purchases/$purchaseId"
                  params={{ purchaseId: c.id }}
                  className="font-mono text-primary underline-offset-2 hover:underline"
                >
                  {c.folio}
                </Link>
                <span className="tabular-nums">{dinero(c.total)}</span>
                <Badge
                  variant={
                    c.status === "confirmed"
                      ? "success"
                      : c.status === "canceled"
                        ? "destructive"
                        : "default"
                  }
                >
                  {t(`purchases.status.${c.status}`)}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {emitiendo && (
        <ConfirmDialog
          data-testid="issue-order"
          title={t("purchaseOrders.confirmDialog.title", { folio: order.folio })}
          body={t("purchaseOrders.confirmDialog.body")}
          confirmLabel={t("purchaseOrders.confirmDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={emitir.isPending}
          onCancel={() => setEmitiendo(false)}
          onConfirm={() => {
            setError(null);
            emitir.mutate(
              { id: order.id },
              {
                onSuccess: () => setEmitiendo(false),
                onError: (apiError) => {
                  setError(apiError.message);
                  setEmitiendo(false);
                },
              },
            );
          }}
        />
      )}

      {cerrando && (
        <ConfirmDialog
          data-testid="close-order"
          title={t("purchaseOrders.closeDialog.title", { folio: order.folio })}
          body={`${t("purchaseOrders.closeDialog.body")} ${cortas > 0 ? t("purchaseOrders.closeDialog.bodyShort", { count: cortas }) : ""}`}
          confirmLabel={t("purchaseOrders.closeDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={cerrar.isPending}
          onCancel={() => setCerrando(false)}
          onConfirm={() => {
            setError(null);
            cerrar.mutate(
              { id: order.id },
              {
                onSuccess: () => setCerrando(false),
                onError: (apiError) => {
                  setError(apiError.message);
                  setCerrando(false);
                },
              },
            );
          }}
        />
      )}

      {anulando && (
        <ConfirmDialog
          data-testid="cancel-order"
          title={t("purchaseOrders.cancelDialog.title", { folio: order.folio })}
          body={t("purchaseOrders.cancelDialog.body")}
          confirmLabel={t("purchaseOrders.cancelDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={anular.isPending}
          confirmDisabled={motivo.trim().length < 3}
          onCancel={() => setAnulando(false)}
          onConfirm={() => {
            setError(null);
            anular.mutate(
              { id: order.id, reason: motivo.trim() },
              {
                onSuccess: () => setAnulando(false),
                onError: (apiError) => {
                  setError(apiError.message);
                  setAnulando(false);
                },
              },
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="purchase-order-cancel-reason">
              {t("purchaseOrders.cancelDialog.reason")}
            </Label>
            <Input
              id="purchase-order-cancel-reason"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            />
          </div>
        </ConfirmDialog>
      )}

      {facturando && (
        <ConfirmDialog
          data-testid="register-purchase-dialog"
          title={t("purchaseOrders.receipts.registerPurchase")}
          body={t("purchaseOrders.receipts.registerPurchaseIntro")}
          confirmLabel={t("purchaseOrders.receipts.registerPurchaseConfirm")}
          cancelLabel={t("common.form.cancel")}
          busy={facturar.isPending}
          confirmDisabled={elegidas.length === 0}
          onCancel={() => setFacturando(false)}
          onConfirm={() => {
            setError(null);
            facturar.mutate(
              { orderId: order.id, receiptIds: elegidas },
              {
                onSuccess: (compra) =>
                  navigate({ to: "/purchases/$purchaseId", params: { purchaseId: compra.id } }),
                onError: (apiError) => {
                  setError(apiError.message);
                  setFacturando(false);
                },
              },
            );
          }}
        >
          <ul className="flex flex-col gap-2">
            {sinFactura.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Checkbox
                  id={`invoice-${r.id}`}
                  aria-label={r.folio}
                  checked={elegidas.includes(r.id)}
                  onCheckedChange={(checked) =>
                    setElegidas((previas) =>
                      checked === true
                        ? [...new Set([...previas, r.id])]
                        : previas.filter((id) => id !== r.id),
                    )
                  }
                />
                <Label htmlFor={`invoice-${r.id}`} className="font-mono">
                  {r.folio}
                </Label>
                <span className="text-muted-foreground text-xs">
                  {formatCalendarDate(r.receivedDate, i18n.language)}
                  {r.packingSlip !== null ? ` · ${r.packingSlip}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  );
}

function Total({
  label,
  value,
  destacado = false,
  testId,
}: {
  label: string;
  value: string;
  destacado?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex w-72 justify-between gap-4">
      <span className={destacado ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span
        {...(testId !== undefined && { "data-testid": testId })}
        className={`tabular-nums ${destacado ? "font-semibold" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}
