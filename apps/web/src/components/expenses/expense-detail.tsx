import { type Currency, formatMoney, PAYMENT_METHODS, type PaymentMethod } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import type { Expense } from "@/lib/expenses/api";
import { useCancelExpense, usePayExpense } from "@/lib/expenses/hooks";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import { useSession } from "@/lib/pos/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-EXP-13 — la ficha del gasto con sus dos acciones: «Marcar como pagado»
 * (entero, una vez; con efectivo ofrece el turno propio como caja de origen)
 * y «Anular» con motivo. Sin `expenses:cancel` no hay «Anular»; un anulado
 * no ofrece nada. Editar vive en el formulario, al lado.
 */
export function ExpenseDetail({ expense, onEdit }: { expense: Expense; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const dinero = (v: string) => formatMoney(Number(v), currency, locale);
  const fecha = (iso: string) => formatCalendarDate(iso, i18n.language);
  const instante = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    );

  const anulado = expense.status === "canceled";
  const pagado = expense.paymentStatus === "paid";
  const puedeEditar = has("expenses:manage") && canWrite && !anulado;
  const puedePagar = puedeEditar && !pagado;
  const puedeAnular = has("expenses:cancel") && canWrite && !anulado;

  const [pagando, setPagando] = useState(false);
  const [metodo, setMetodo] = useState<PaymentMethod>("cash");
  const [cuenta, setCuenta] = useState(expense.accountRef ?? "");
  const [caja, setCaja] = useState("");
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pagar = usePayExpense();
  const anular = useCancelExpense();
  const sesion = useSession();
  const propio = sesion.data?.session ?? null;

  return (
    <section className="flex flex-col gap-4" data-testid="expense-detail">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="font-semibold text-xl">
            {t("expenses.detail.title", { folio: expense.folio })}
          </h1>
          <Badge variant={pagado ? "success" : "warning"}>
            {t(`expenses.paymentStatusLabel.${expense.paymentStatus}`)}
          </Badge>
          {anulado && <Badge variant="destructive">{t("expenses.status.canceled")}</Badge>}
        </div>
        <div className="flex gap-2">
          {puedeEditar && (
            <Button type="button" variant="outline" onClick={onEdit}>
              {t("expenses.detail.edit")}
            </Button>
          )}
          {puedePagar && (
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setCaja(propio?.id ?? "");
                setPagando(true);
              }}
            >
              {t("expenses.detail.pay")}
            </Button>
          )}
          {puedeAnular && (
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setError(null);
                setMotivo("");
                setAnulando(true);
              }}
            >
              {t("expenses.detail.cancel")}
            </Button>
          )}
        </div>
      </div>

      {anulado && expense.canceledAt && (
        <p
          role="status"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {t("expenses.detail.canceledOn", {
            date: instante(expense.canceledAt),
            reason: expense.cancelReason ?? "",
          })}
        </p>
      )}

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Campo label={t("expenses.list.columns.date")}>{fecha(expense.expenseDate)}</Campo>
        <Campo label={t("expenses.list.columns.category")}>{expense.categoryName}</Campo>
        <Campo label={t("expenses.list.columns.payee")}>
          {expense.supplierName ?? expense.beneficiary ?? "—"}
        </Campo>
        <Campo label={t("expenses.detail.warehouse")}>{expense.warehouseName}</Campo>
        <Campo label={t("expenses.list.columns.description")}>{expense.description}</Campo>
        <Campo label={t("expenses.detail.reference")}>{expense.reference ?? "—"}</Campo>
        <Campo label={t("expenses.detail.amount")}>{dinero(expense.amount)}</Campo>
        <Campo label={t("expenses.detail.discount")}>
          {Number(expense.discount) > 0 ? `−${dinero(expense.discount)}` : "—"}
        </Campo>
        <Campo label={t("expenses.detail.taxAmount")}>
          {expense.taxGroupCode === null
            ? t("expenses.detail.noTax")
            : `${dinero(expense.taxAmount)} · ${expense.taxGroupCode} (${t(
                expense.taxMode === "included"
                  ? "expenses.detail.taxIncluded"
                  : "expenses.detail.taxExcluded",
              )})`}
        </Campo>
        <Campo label={t("expenses.detail.total")}>
          <span className="font-semibold" data-testid="expense-total">
            {dinero(expense.total)}
          </span>
        </Campo>
        {pagado && expense.paidAt && (
          <Campo label={t("expenses.list.columns.payment")}>
            {t(`pos.payment.${expense.paymentMethod}`)} ·{" "}
            {t("expenses.detail.paidOn", { date: instante(expense.paidAt) })}
            {expense.cashboxSessionId && (
              <span className="block text-muted-foreground text-xs">
                {t("expenses.detail.fromShift")}
              </span>
            )}
          </Campo>
        )}
        {!pagado && expense.dueDate && (
          <Campo label={t("expenses.detail.dueDate")}>{fecha(expense.dueDate)}</Campo>
        )}
        <Campo label={t("expenses.detail.account")}>{expense.accountRef ?? "—"}</Campo>
        <Campo label={t("expenses.detail.notes")}>{expense.notes ?? "—"}</Campo>
      </dl>

      {pagando && (
        <ConfirmDialog
          data-testid="pay-expense"
          title={t("expenses.pay.title", { folio: expense.folio })}
          body={t("expenses.pay.body")}
          confirmLabel={t("expenses.pay.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={pagar.isPending}
          {...(error !== null && { error })}
          onCancel={() => setPagando(false)}
          onConfirm={() => {
            setError(null);
            pagar.mutate(
              {
                id: expense.id,
                input: {
                  paymentMethod: metodo,
                  ...(cuenta.trim() !== "" && { accountRef: cuenta.trim() }),
                  ...(metodo === "cash" && caja !== "" && { cashboxSessionId: caja }),
                },
              },
              { onSuccess: () => setPagando(false), onError: (e) => setError(e.message) },
            );
          }}
        >
          <div className="flex flex-col gap-3">
            <SelectField
              label={t("expenses.pay.method")}
              value={metodo}
              onChange={(e) => setMetodo(e.target.value as PaymentMethod)}
              options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`pos.payment.${m}`) }))}
            />
            {metodo === "cash" && propio !== null && (
              <SelectField
                label={t("expenses.form.cashbox")}
                hint={t("expenses.form.cashboxHint")}
                value={caja}
                onChange={(e) => setCaja(e.target.value)}
                options={[
                  { value: "", label: t("expenses.form.cashboxNone") },
                  {
                    value: propio.id,
                    label: t("expenses.form.cashboxOwn", { warehouse: propio.warehouse.name }),
                  },
                ]}
              />
            )}
            <TextField
              label={t("expenses.form.account")}
              value={cuenta}
              onChange={(e) => setCuenta(e.target.value)}
            />
          </div>
        </ConfirmDialog>
      )}

      {anulando && (
        <ConfirmDialog
          data-testid="cancel-expense"
          title={t("expenses.cancelDialog.title", { folio: expense.folio })}
          body={t("expenses.cancelDialog.body")}
          confirmLabel={t("expenses.cancelDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={anular.isPending}
          // El motivo es obligatorio en el API (mínimo 3): decirlo antes del clic.
          confirmDisabled={motivo.trim().length < 3}
          {...(error !== null && { error })}
          onCancel={() => setAnulando(false)}
          onConfirm={() => {
            setError(null);
            anular.mutate(
              { id: expense.id, reason: motivo.trim() },
              {
                onSuccess: () => setAnulando(false),
                onError: (e) => setError(e.message || t("expenses.cancelDialog.failed")),
              },
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="expense-cancel-reason">{t("expenses.cancelDialog.reason")}</Label>
            <Input
              id="expense-cancel-reason"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </ConfirmDialog>
      )}
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
