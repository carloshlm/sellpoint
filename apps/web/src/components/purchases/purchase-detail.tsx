import { type Currency, formatMoney } from "@sellpoint/shared";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateField } from "@/components/form/date-field";
import { MoneyField } from "@/components/form/money-field";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import type { LineasHandle } from "@/components/purchase-orders/purchase-order-lines-table";
import { PurchaseCharges } from "@/components/purchases/purchase-charges";
import { PurchaseLinesTable } from "@/components/purchases/purchase-lines-table";
import { SupplierPicker } from "@/components/suppliers/supplier-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CanceledNotice } from "@/components/ui/canceled-notice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SuccessNotice } from "@/components/ui/success-notice";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { businessToday } from "@/lib/inventory/format-date";
import type { Purchase, UpdatePurchaseInput } from "@/lib/purchases/api";
import { printPurchase } from "@/lib/purchases/api";
import {
  useCancelPurchase,
  useConfirmPurchase,
  useCreateEntryDraft,
  useUpdatePurchase,
  useUpdateReception,
} from "@/lib/purchases/hooks";
import { useAutosave } from "@/lib/use-autosave";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-PURCH-11/12 — la pantalla de la compra: la factura del proveedor tal
 * como llegó, y el botón que la convierte en mercancía.
 *
 * La CABECERA se autoguarda campo por campo (cada uno es independiente); las
 * LÍNEAS van en bloque porque cada guardado recompone los impuestos. Una
 * compra confirmada solo deja anotar la recepción, la factura y las notas: lo
 * demás ya se selló y su papel se imprimió.
 *
 * El descuadre contra el total declarado **avisa y no bloquea** (Carlos,
 * 2026-09-10): ajustar las líneas para que cuadren pisaría el costo del
 * catálogo con un número inventado.
 */
export function PurchaseDetail({ purchase }: { purchase: Purchase }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const timeZone = useAuthStore((s) => s.user?.tenant.timezone);
  // F9-COSTMODE-04: la opción que coincide con el ajuste del negocio se marca.
  const costTaxMode = useAuthStore((s) => s.user?.tenant.costTaxMode ?? "excluded");
  const etiquetaDeModo = (modo: Purchase["taxMode"]) =>
    `${t(modo === "excluded" ? "purchases.detail.taxModeExcluded" : "purchases.detail.taxModeIncluded")}${
      modo === costTaxMode ? ` ${t("purchases.detail.taxModeDefault")}` : ""
    }`;
  // Ni la factura ni la recepción son de mañana: el API lo rebota
  // (`purchases.date_in_future`) y el calendario no lo ofrece.
  const hoy = businessToday(timeZone);

  const borrador = purchase.status === "draft";
  const confirmada = purchase.status === "confirmed" || purchase.status === "stocked";
  const puedeEditar = has("purchases:manage") && canWrite;
  const puedeAnular = has("purchases:cancel") && canWrite && purchase.status !== "canceled";
  const puedeIngresar = puedeEditar && has("inventory:movement") && confirmada;

  const [supplierId, setSupplierId] = useState(purchase.supplierId);
  const [purchaseDate, setPurchaseDate] = useState(purchase.purchaseDate);
  const [receivedDate, setReceivedDate] = useState(purchase.receivedDate ?? "");
  const [supplierInvoice, setSupplierInvoice] = useState(purchase.supplierInvoice ?? "");
  const [declaredTotal, setDeclaredTotal] = useState(purchase.declaredTotal ?? "");
  const [taxMode, setTaxMode] = useState(purchase.taxMode);
  const [notes, setNotes] = useState(purchase.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  // Se acaba de confirmar en ESTA pantalla: el aviso verde se trae a la vista.
  const [confirmadaAhora, setConfirmadaAhora] = useState(false);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");

  const guardarCabecera = useUpdatePurchase();
  const guardarRecepcion = useUpdateReception();
  const confirmar = useConfirmPurchase();
  const anular = useCancelPurchase();
  const lineasRef = useRef<LineasHandle>(null);
  const cargosRef = useRef<LineasHandle>(null);
  const ingresar = useCreateEntryDraft();

  // Autoguardado ACUMULADO (`useAutosave`): un PATCH por pausa con todo lo
  // tecleado; en una confirmada solo viaja lo que no mueve dinero.
  const autoguardar = useAutosave<UpdatePurchaseInput>((cambios) => {
    setError(null);
    const onError = (apiError: { message: string }) => setError(apiError.message);
    if (borrador) {
      guardarCabecera.mutate({ id: purchase.id, input: cambios }, { onError });
      return;
    }
    const { receivedDate: rd, supplierInvoice: si, notes: nt } = cambios;
    if (rd === undefined && si === undefined && nt === undefined) return;
    guardarRecepcion.mutate(
      { id: purchase.id, input: { receivedDate: rd, supplierInvoice: si, notes: nt } },
      { onError },
    );
  });

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const fecha = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    );

  return (
    <div className="flex flex-col gap-4" data-testid="purchase-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-xl">
            {t("purchases.detail.title", { folio: purchase.folio })}
          </h1>
          <Badge
            variant={
              purchase.status === "canceled"
                ? "destructive"
                : purchase.status === "stocked"
                  ? "success"
                  : confirmada
                    ? "warning"
                    : "default"
            }
          >
            {t(`purchases.status.${purchase.status}`)}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {!borrador && (
            <Button
              type="button"
              variant="outline"
              onClick={() => void printPurchase(purchase.id, purchase.folio)}
            >
              {t("purchases.detail.print")}
            </Button>
          )}
          {borrador && puedeEditar && (
            <Button
              type="button"
              onClick={() => {
                // Lo tecleado en líneas y cargos se guarda ANTES de preguntar
                // (Carlos, 2026-09-11): confirmar con cambios sin guardar
                // sellaría un papel distinto del que se ve en pantalla.
                setError(null);
                Promise.resolve()
                  .then(() => lineasRef.current?.guardarSiHayCambios())
                  .then(() => cargosRef.current?.guardarSiHayCambios())
                  .then(() => setConfirmando(true))
                  .catch((apiError: { message: string }) => setError(apiError.message));
              }}
            >
              {t("purchases.detail.confirm")}
            </Button>
          )}
          {/* Solo sobre una compra CONFIRMADA: el borrador todavía puede cambiar
              de líneas, y la entrada nacería de un papel que no está cerrado. */}
          {puedeIngresar &&
            (purchase.entry === null ? (
              <Button
                type="button"
                disabled={ingresar.isPending}
                onClick={() => {
                  setError(null);
                  ingresar.mutate(purchase.id, {
                    onSuccess: (entrada) =>
                      navigate({
                        to: "/movements/documents/$documentId",
                        params: { documentId: entrada.id },
                      }),
                    onError: (apiError) => setError(apiError.message),
                  });
                }}
              >
                {t("purchases.detail.toInventory")}
              </Button>
            ) : purchase.entry.status === "draft" ? (
              <Button
                type="button"
                data-testid="continue-entry"
                onClick={() =>
                  navigate({
                    to: "/movements/documents/$documentId",
                    params: { documentId: purchase.entry?.id ?? "" },
                  })
                }
              >
                {t("purchases.detail.continueEntry", { folio: purchase.entry.folio })}
              </Button>
            ) : (
              <span className="self-center text-muted-foreground text-sm">
                {t("purchases.detail.entryConfirmed", { folio: purchase.entry.folio })}
              </span>
            ))}
          {puedeAnular && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setMotivo("");
                setAnulando(true);
              }}
            >
              {t("purchases.detail.cancel")}
            </Button>
          )}
        </div>
      </div>

      {confirmadaAhora && confirmada && (
        <SuccessNotice testId="purchase-confirmed">
          {t("purchases.detail.confirmedNotice")}
        </SuccessNotice>
      )}
      {error !== null && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {purchase.status === "canceled" && purchase.canceledAt !== null && (
        <CanceledNotice testId="purchase-canceled">
          {t("purchases.detail.canceledOn", {
            date: fecha(purchase.canceledAt),
            reason: purchase.cancelReason ?? "",
          })}
        </CanceledNotice>
      )}
      {confirmada && (
        <p className="text-muted-foreground text-sm">{t("purchases.detail.sealed")}</p>
      )}
      {/* F9-PO-13: de dónde nació. El hilo del three-way match, a la vista. */}
      {purchase.order !== null && (
        <p className="text-muted-foreground text-sm" data-testid="purchase-origin">
          {t("purchases.detail.origin")}{" "}
          <Link
            to="/purchase-orders/$orderId"
            params={{ orderId: purchase.order.id }}
            className="font-mono text-primary underline-offset-2 hover:underline"
          >
            {purchase.order.folio}
          </Link>
          {purchase.receipts.length > 0 && (
            <>
              {" · "}
              {t("purchases.detail.originReceipts")}{" "}
              {purchase.receipts.map((r, i) => (
                <span key={r.id}>
                  {i > 0 ? ", " : ""}
                  <Link
                    to="/purchase-orders/$orderId/receipts/$receiptId"
                    params={{ orderId: purchase.order?.id ?? "", receiptId: r.id }}
                    className="font-mono text-primary underline-offset-2 hover:underline"
                  >
                    {r.folio}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("purchases.detail.supplier")}</CardTitle>
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
                label={t("purchases.detail.supplier")}
              />
            ) : (
              <div className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {t("purchases.detail.supplier")}
                </span>
                <span className="font-medium">{purchase.supplierName}</span>
              </div>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                {t("purchases.detail.warehouse")}
              </span>
              <span className="font-medium">{purchase.warehouseName}</span>
            </div>
            <DateField
              label={t("purchases.detail.date")}
              max={hoy}
              value={purchaseDate}
              disabled={!borrador || !puedeEditar}
              onChange={(event) => {
                setPurchaseDate(event.target.value);
                autoguardar({ purchaseDate: event.target.value });
              }}
            />
            <DateField
              label={t("purchases.detail.receivedDate")}
              max={hoy}
              value={receivedDate}
              disabled={!puedeEditar || purchase.status === "canceled"}
              onChange={(event) => {
                setReceivedDate(event.target.value);
                autoguardar({ receivedDate: event.target.value || null });
              }}
            />
            <TextField
              label={t("purchases.detail.invoice")}
              value={supplierInvoice}
              disabled={!puedeEditar || purchase.status === "canceled"}
              onChange={(event) => {
                setSupplierInvoice(event.target.value);
                autoguardar({ supplierInvoice: event.target.value || null });
              }}
            />
            <SelectField
              label={t("purchases.detail.taxMode")}
              value={taxMode}
              disabled={!borrador || !puedeEditar}
              options={[
                { value: "excluded", label: etiquetaDeModo("excluded") },
                { value: "included", label: etiquetaDeModo("included") },
              ]}
              onChange={(event) => {
                const modo = event.target.value as Purchase["taxMode"];
                setTaxMode(modo);
                autoguardar({ taxMode: modo });
              }}
            />
            <MoneyField
              label={t("purchases.detail.declaredTotal")}
              hint={t("purchases.detail.declaredHint")}
              value={declaredTotal}
              disabled={!borrador || !puedeEditar}
              onChange={(valor) => {
                setDeclaredTotal(valor);
                autoguardar({ declaredTotal: valor.trim() === "" ? null : Number(valor) });
              }}
            />
            <TextField
              label={t("purchases.detail.notes")}
              className="sm:col-span-2"
              value={notes}
              disabled={!puedeEditar || purchase.status === "canceled"}
              onChange={(event) => {
                setNotes(event.target.value);
                autoguardar({ notes: event.target.value || null });
              }}
            />
          </div>
        </CardContent>
      </Card>

      <PurchaseLinesTable ref={lineasRef} purchase={purchase} />
      <PurchaseCharges ref={cargosRef} purchase={purchase} />

      <section className="flex flex-col items-end gap-1 text-sm" data-testid="purchase-totals">
        <Total label={t("purchases.totals.subtotal")} value={dinero(purchase.subtotal)} />
        {Number(purchase.discount) > 0 && (
          <Total label={t("purchases.totals.discount")} value={`−${dinero(purchase.discount)}`} />
        )}
        {purchase.taxes.map((tax) => (
          <Total key={tax.code} label={`${tax.name} (${tax.rate}%)`} value={dinero(tax.amount)} />
        ))}
        {Number(purchase.extraChargesTotal) > 0 && (
          <Total label={t("purchases.totals.charges")} value={dinero(purchase.extraChargesTotal)} />
        )}
        <Total
          label={t("purchases.totals.total")}
          value={dinero(purchase.total)}
          destacado
          testId="purchase-total"
        />
        {purchase.declaredTotal !== null && (
          <Total label={t("purchases.totals.declared")} value={dinero(purchase.declaredTotal)} />
        )}
        {/* F9-PO-13: facturar MÁS de lo recibido avisa; tampoco bloquea. */}
        {purchase.quantityVariance && (
          <p role="alert" data-testid="purchase-quantity-variance" className="text-warning">
            {t("purchases.totals.quantityVariance")}
          </p>
        )}
        {/* El descuadre AVISA. Nunca deshabilita «Confirmar»: el papel dice lo
            que dice, y ajustar las líneas para cuadrarlo pisaría el costo del
            catálogo con un número inventado. */}
        {purchase.mismatch && (
          <p role="alert" data-testid="purchase-mismatch" className="text-destructive">
            {t("purchases.totals.mismatch", { difference: dinero(purchase.difference ?? "0") })}
          </p>
        )}
      </section>

      {confirmando && (
        <ConfirmDialog
          data-testid="confirm-purchase"
          title={t("purchases.confirmDialog.title", { folio: purchase.folio })}
          body={t("purchases.confirmDialog.body")}
          confirmLabel={t("purchases.confirmDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={confirmar.isPending}
          onCancel={() => setConfirmando(false)}
          onConfirm={() => {
            setError(null);
            confirmar.mutate(
              { id: purchase.id },
              {
                onSuccess: () => {
                  setConfirmando(false);
                  setConfirmadaAhora(true);
                },
                onError: (apiError) => {
                  setError(apiError.message);
                  setConfirmando(false);
                },
              },
            );
          }}
        />
      )}

      {anulando && (
        <ConfirmDialog
          data-testid="cancel-purchase"
          title={t("purchases.cancelDialog.title", { folio: purchase.folio })}
          body={t("purchases.cancelDialog.body")}
          confirmLabel={t("purchases.cancelDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={anular.isPending}
          // El motivo es obligatorio en el API (mínimo 3): decirlo antes del clic.
          confirmDisabled={motivo.trim().length < 3}
          onCancel={() => setAnulando(false)}
          onConfirm={() => {
            setError(null);
            anular.mutate(
              { id: purchase.id, reason: motivo.trim() },
              {
                onSuccess: () => setAnulando(false),
                onError: (apiError) => {
                  setError(apiError.message || t("purchases.cancelDialog.failed"));
                  setAnulando(false);
                },
              },
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="purchase-cancel-reason">{t("purchases.cancelDialog.reason")}</Label>
            <Input
              id="purchase-cancel-reason"
              value={motivo}
              onChange={(event) => setMotivo(event.target.value)}
            />
          </div>
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
    <div className="flex w-64 justify-between gap-4">
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
