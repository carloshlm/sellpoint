import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateField } from "@/components/form/date-field";
import { TextField } from "@/components/form/text-field";
import { LotCells } from "@/components/inventory/lot-cells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CanceledNotice } from "@/components/ui/canceled-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { SuccessNotice } from "@/components/ui/success-notice";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { businessToday } from "@/lib/inventory/format-date";
import type { PurchaseReceipt, PurchaseReceiptLineInput } from "@/lib/purchase-orders/api";
import {
  useCancelPurchaseReceipt,
  useConfirmPurchaseReceipt,
  useReplacePurchaseReceiptLines,
  useUpdatePurchaseReceipt,
} from "@/lib/purchase-orders/hooks";
import { useAutosave } from "@/lib/use-autosave";
import { useAuthStore } from "@/stores/auth.store";

interface LineaEditable {
  uid: string;
  purchaseOrderLineId: string;
  productId: string;
  sku: string;
  description: string;
  presentationName: string | null;
  tracksLots: boolean;
  quantityOrdered: string;
  quantityReceived: string;
  pending: string;
  quantity: string;
  lotCode: string;
  expiresAt: string;
}

const aEditable = (r: PurchaseReceipt): LineaEditable[] =>
  r.lines.map((l) => ({
    uid: l.id,
    purchaseOrderLineId: l.purchaseOrderLineId,
    productId: l.productId,
    sku: l.productSku,
    description: l.description,
    presentationName: l.presentationName,
    tracksLots: l.tracksLots,
    quantityOrdered: l.quantityOrdered,
    quantityReceived: l.quantityReceived,
    pending: l.pending,
    quantity: l.quantity,
    lotCode: l.lotCode ?? "",
    expiresAt: l.expiresAt ?? "",
  }));

type CabeceraDeRecepcion = {
  receivedDate?: string;
  packingSlip?: string | null;
  notes?: string | null;
};

/**
 * F9-PO-13 — la RECEPCIÓN: el papel del andén. Nace prellenada con lo
 * pendiente de la orden; se quita lo que no llegó, se ajusta lo que llegó
 * incompleto y se anota el lote con las MISMAS celdas que la compra
 * (`LotCells`). Confirmarla suma a la orden — la mercancía entra al
 * inventario cuando se registre la compra sobre ella y su entrada.
 */
export function PurchaseReceiptDetail({ receipt }: { receipt: PurchaseReceipt }) {
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const hoy = businessToday(useAuthStore((s) => s.user?.tenant.timezone));
  const borrador = receipt.status === "draft";
  const puedeEditar = has("purchases:manage") && canWrite;
  const facturada = receipt.purchase !== null && receipt.purchase.status !== "canceled";
  const puedeAnular =
    has("purchases:cancel") && canWrite && receipt.status !== "canceled" && !facturada;

  const [receivedDate, setReceivedDate] = useState(receipt.receivedDate);
  const [packingSlip, setPackingSlip] = useState(receipt.packingSlip ?? "");
  const [notes, setNotes] = useState(receipt.notes ?? "");
  const [lineas, setLineas] = useState<LineaEditable[]>(() => aEditable(receipt));
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  // Se acaba de confirmar en ESTA pantalla: el aviso verde se trae a la vista.
  const [confirmadaAhora, setConfirmadaAhora] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const guardarCabecera = useUpdatePurchaseReceipt();
  const guardarLineas = useReplacePurchaseReceiptLines();
  const confirmar = useConfirmPurchaseReceipt();
  const anular = useCancelPurchaseReceipt();
  const onError = (apiError: { message: string }) => setError(apiError.message);
  const ids = { orderId: receipt.purchaseOrderId, receiptId: receipt.id };

  const firmaDeLineas = JSON.stringify([receipt.status, receipt.lines]);
  // Se resincroniza SOLO cuando las LÍNEAS del servidor cambian (por su
  // firma), no cada vez que llega el objeto entero: el autoguardado de la
  // cabecera devuelve el documento completo y, con `[documento]` como
  // dependencia, pisaba lo que el usuario estaba tecleando en la tabla antes
  // de guardar (lo cazó el navegador el 2026-09-11: 6 tecleados, 10 guardados).
  // biome-ignore lint/correctness/useExhaustiveDependencies: la dependencia real es la firma de las líneas
  useEffect(() => {
    setLineas(aEditable(receipt));
  }, [firmaDeLineas]);

  const autoguardar = useAutosave<CabeceraDeRecepcion>((cambios) => {
    setError(null);
    guardarCabecera.mutate({ ...ids, input: cambios }, { onError });
  });
  const cambiar = (index: number, campo: keyof LineaEditable, valor: string) =>
    setLineas((previas) => previas.map((l, i) => (i === index ? { ...l, [campo]: valor } : l)));
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    );

  const armarPayload = (): PurchaseReceiptLineInput[] =>
    lineas.map((l) => ({
      purchaseOrderLineId: l.purchaseOrderLineId,
      quantity: Number(l.quantity),
      lotCode: l.lotCode.trim() === "" ? null : l.lotCode.trim(),
      expiresAt: l.expiresAt === "" ? null : l.expiresAt,
    }));
  const guardar = () => {
    setError(null);
    guardarLineas.mutate({ ...ids, lines: armarPayload() }, { onError });
  };
  // Confirmar GUARDA primero lo tecleado (cantidad, lote, caducidad): sin esto,
  // un lote capturado sin «Guardar líneas» se perdía al confirmar y la compra
  // nacía sin él (Carlos, 2026-09-12). Mismo trato que emitir/confirmar compra.
  const sucia = JSON.stringify(lineas) !== JSON.stringify(aEditable(receipt));
  const pedirConfirmar = () => {
    setError(null);
    if (!sucia) {
      setConfirmando(true);
      return;
    }
    guardarLineas
      .mutateAsync({ ...ids, lines: armarPayload() })
      .then(() => setConfirmando(true))
      .catch(onError);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="purchase-receipt-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-semibold text-xl">
            {t("purchaseOrders.receipt.title", { folio: receipt.folio })}
          </h1>
          <Badge
            variant={
              receipt.status === "confirmed"
                ? "success"
                : receipt.status === "canceled"
                  ? "destructive"
                  : "default"
            }
          >
            {t(`purchaseOrders.receiptStatus.${receipt.status}`)}
          </Badge>
          <Link
            to="/purchase-orders/$orderId"
            params={{ orderId: receipt.purchaseOrderId }}
            className="text-primary text-sm underline-offset-2 hover:underline"
          >
            {t("purchaseOrders.receipt.of", { folio: receipt.orderFolio })}
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          {borrador && puedeEditar && (
            <Button type="button" onClick={pedirConfirmar}>
              {t("purchaseOrders.receipt.confirm")}
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
              {t("purchaseOrders.receipt.cancel")}
            </Button>
          )}
        </div>
      </div>

      {confirmadaAhora && receipt.status === "confirmed" && (
        <SuccessNotice testId="receipt-confirmed">
          {t("purchaseOrders.receipt.confirmedNotice")}
        </SuccessNotice>
      )}
      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {facturada && receipt.purchase !== null && (
        <p role="status" className="text-muted-foreground text-sm">
          {t("purchaseOrders.receipt.invoiced", { folio: receipt.purchase.folio })}
        </p>
      )}
      {receipt.status === "confirmed" && !facturada && (
        <p className="text-muted-foreground text-sm">{t("purchaseOrders.receipt.sealed")}</p>
      )}
      {receipt.status === "canceled" && receipt.canceledAt !== null && (
        <CanceledNotice testId="receipt-canceled">
          {t("purchaseOrders.detail.canceledOn", {
            date: fecha(receipt.canceledAt),
            reason: receipt.cancelReason ?? "",
          })}
        </CanceledNotice>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("purchaseOrders.receipt.receivedDate")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <DateField
              label={t("purchaseOrders.receipt.receivedDate")}
              max={hoy}
              value={receivedDate}
              disabled={!borrador || !puedeEditar}
              onChange={(event) => {
                setReceivedDate(event.target.value);
                if (event.target.value !== "") autoguardar({ receivedDate: event.target.value });
              }}
            />
            <TextField
              label={t("purchaseOrders.receipt.packingSlip")}
              hint={t("purchaseOrders.receipt.packingSlipHint")}
              value={packingSlip}
              disabled={!borrador || !puedeEditar}
              onChange={(event) => {
                setPackingSlip(event.target.value);
                autoguardar({ packingSlip: event.target.value || null });
              }}
            />
            <TextField
              label={t("purchaseOrders.receipt.notes")}
              className="sm:col-span-2"
              value={notes}
              disabled={!borrador || !puedeEditar}
              onChange={(event) => {
                setNotes(event.target.value);
                autoguardar({ notes: event.target.value || null });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" data-testid="purchase-receipt-lines">
        <div>
          <h2 className="font-medium">{t("purchaseOrders.receipt.linesTitle")}</h2>
          {borrador && (
            <p className="text-muted-foreground text-sm">
              {t("purchaseOrders.receipt.linesIntro")}
            </p>
          )}
        </div>
        {lineas.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("purchaseOrders.receipt.empty")}</p>
        ) : (
          <ScrollableTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left hover:bg-transparent">
                  <th className="p-2">{t("purchaseOrders.lines.product")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.receipt.ordered")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.receipt.receivedBefore")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.receipt.pending")}</th>
                  <th className="p-2 text-right">{t("purchaseOrders.receipt.quantity")}</th>
                  <th className="p-2">{t("purchaseOrders.receipt.lot")}</th>
                  <th className="p-2">{t("purchaseOrders.receipt.expiresAt")}</th>
                  {borrador && <th className="p-2" />}
                </tr>
              </thead>
              <tbody>
                {lineas.map((linea, index) => (
                  <tr
                    key={linea.uid}
                    data-testid={`receipt-line-${index}`}
                    className="border-b last:border-0 hover:bg-muted/50 [&>td]:align-top"
                  >
                    <td className="p-2">
                      <span className="block font-medium">{linea.description}</span>
                      <span className="font-mono text-muted-foreground text-xs">
                        {linea.sku}
                        {linea.presentationName !== null ? ` · ${linea.presentationName}` : ""}
                      </span>
                    </td>
                    <td className="p-2 text-right tabular-nums">{linea.quantityOrdered}</td>
                    <td className="p-2 text-right tabular-nums">{linea.quantityReceived}</td>
                    <td className="p-2 text-right tabular-nums">{linea.pending}</td>
                    <td className="p-2 text-right">
                      {borrador ? (
                        <Input
                          aria-label={t("purchaseOrders.receipt.quantity")}
                          className="ml-auto w-24 text-right tabular-nums"
                          inputMode="decimal"
                          value={linea.quantity}
                          disabled={!puedeEditar}
                          onChange={(event) => cambiar(index, "quantity", event.target.value)}
                        />
                      ) : (
                        <span className="tabular-nums">{linea.quantity}</span>
                      )}
                    </td>
                    <LotCells
                      productId={linea.productId}
                      controlaLote={linea.tracksLots}
                      lotCode={linea.lotCode}
                      expiresAt={linea.expiresAt}
                      editable={borrador && puedeEditar}
                      onLotCode={(valor) => cambiar(index, "lotCode", valor)}
                      onExpiresAt={(valor) => cambiar(index, "expiresAt", valor)}
                      lotLabel={t("purchaseOrders.receipt.lot")}
                      expiresLabel={t("purchaseOrders.receipt.expiresAt")}
                    />
                    {borrador && (
                      <td className="p-2 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={!puedeEditar}
                          onClick={() =>
                            setLineas((previas) => previas.filter((_, i) => i !== index))
                          }
                        >
                          {t("purchaseOrders.receipt.remove")}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableTable>
        )}
        {borrador && puedeEditar && (
          <div>
            <Button type="button" onClick={guardar} disabled={guardarLineas.isPending}>
              {guardarLineas.isPending
                ? t("common.form.submitting")
                : t("purchaseOrders.receipt.save")}
            </Button>
          </div>
        )}
      </section>

      {confirmando && (
        <ConfirmDialog
          data-testid="confirm-receipt"
          title={t("purchaseOrders.receipt.confirmDialog.title", { folio: receipt.folio })}
          body={t("purchaseOrders.receipt.confirmDialog.body")}
          confirmLabel={t("purchaseOrders.receipt.confirmDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={confirmar.isPending}
          onCancel={() => setConfirmando(false)}
          onConfirm={() => {
            setError(null);
            confirmar.mutate(ids, {
              onSuccess: () => {
                setConfirmando(false);
                setConfirmadaAhora(true);
              },
              onError: (apiError) => {
                setError(apiError.message);
                setConfirmando(false);
              },
            });
          }}
        />
      )}

      {anulando && (
        <ConfirmDialog
          data-testid="cancel-receipt"
          title={t("purchaseOrders.receipt.cancelDialog.title", { folio: receipt.folio })}
          body={t("purchaseOrders.receipt.cancelDialog.body")}
          confirmLabel={t("purchaseOrders.receipt.cancelDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={anular.isPending}
          confirmDisabled={motivo.trim().length < 3}
          onCancel={() => setAnulando(false)}
          onConfirm={() => {
            setError(null);
            anular.mutate(
              { ...ids, reason: motivo.trim() },
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
            <Label htmlFor="purchase-receipt-cancel-reason">
              {t("purchaseOrders.receipt.cancelDialog.reason")}
            </Label>
            <Input
              id="purchase-receipt-cancel-reason"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            />
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
