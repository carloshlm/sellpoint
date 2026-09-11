import { PAYMENT_METHODS, type PaymentMethod, parseMoneyInput } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateField } from "@/components/form/date-field";
import { MoneyField } from "@/components/form/money-field";
import { SelectField } from "@/components/form/select-field";
import { TaxGroupSelect } from "@/components/form/tax-group-select";
import { TextField } from "@/components/form/text-field";
import { SupplierPicker } from "@/components/suppliers/supplier-picker";
import { Button } from "@/components/ui/button";
import { ErrorNotice } from "@/components/ui/error-notice";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import type { CreateExpenseInput, Expense, UpdateExpenseInput } from "@/lib/expenses/api";
import { useExpenseCategories } from "@/lib/expenses/categories-hooks";
import { useCreateExpense, useExpenseAccounts, useUpdateExpense } from "@/lib/expenses/hooks";
import { expenseFormSchema } from "@/lib/expenses/schemas";
import { moneyInitialValue, moneyInputError } from "@/lib/money";
import { useSession } from "@/lib/pos/hooks";
import { useShiftsReport } from "@/lib/reports/hooks";
import { useScrollIntoView } from "@/lib/use-scroll-into-view";
import { useAuthStore } from "@/stores/auth.store";

type Errores = Partial<
  Record<"expenseDate" | "categoryId" | "description" | "amount" | "discount" | "dueDate", string>
>;

/** El «método» del selector: un método real o `""` = pendiente de pago. */
type Pago = PaymentMethod | "";

/**
 * F9-EXP-14 — alta y edición de gasto en el MISMO formulario (skill
 * `sellpoint-forms`: tarjeta, rejilla de dos columnas, hints, error del API
 * arriba con el foco).
 *
 * Al crear: fecha, categoría, a quién (proveedor del catálogo O beneficiario
 * libre, excluyentes), monto y descuento, impuesto, cómo se pagó («Pendiente»
 * esconde el método y muestra el vencimiento; «Efectivo» muestra la caja de
 * origen con el turno propio preseleccionado), cuenta, referencia,
 * descripción y notas. Al editar, el pago no se toca aquí (se paga desde la
 * ficha) y, si ya está pagado, el dinero queda deshabilitado.
 */
export function ExpenseForm({
  expense,
  onDone,
  onCancel,
}: {
  expense?: Expense;
  onDone: (expense?: Expense) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const formRef = useScrollIntoView<HTMLFormElement>({ focusFirstField: true, block: "start" });
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const hoy = new Date().toISOString().slice(0, 10);

  const [expenseDate, setExpenseDate] = useState(expense?.expenseDate ?? hoy);
  const [categoryId, setCategoryId] = useState(expense?.categoryId ?? "");
  const [supplierId, setSupplierId] = useState<string | null>(expense?.supplierId ?? null);
  const [beneficiary, setBeneficiary] = useState(expense?.beneficiary ?? "");
  const [amount, setAmount] = useState(moneyInitialValue(expense?.amount));
  const [discount, setDiscount] = useState(
    expense && Number(expense.discount) > 0 ? moneyInitialValue(expense.discount) : "",
  );
  const [taxGroupId, setTaxGroupId] = useState<string | null>(null);
  const [pago, setPago] = useState<Pago>("");
  const [cashboxSessionId, setCashboxSessionId] = useState("");
  const [accountRef, setAccountRef] = useState(expense?.accountRef ?? "");
  const [dueDate, setDueDate] = useState(expense?.dueDate ?? "");
  const [reference, setReference] = useState(expense?.reference ?? "");
  const [description, setDescription] = useState(expense?.description ?? "");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [errores, setErrores] = useState<Errores>({});
  const [errorApi, setErrorApi] = useState<string | null>(null);

  const pagado = expense?.paymentStatus === "paid";
  const editando = expense !== undefined;
  const categorias = useExpenseCategories({ isActive: true, pageSize: 100 });
  const cuentas = useExpenseAccounts();
  // La caja de origen: el turno propio (siempre elegible) y los abiertos en
  // alcance, que solo se piden con `reports:read` — sin él, con el propio basta.
  const sesion = useSession();
  const propio = sesion.data?.session ?? null;
  const abiertos = useShiftsReport({ status: "open", page: 1, pageSize: 50 });
  const puedeVerOtros = has("reports:read");
  const mostrarCaja = !editando && pago === "cash";
  const [cajaInicializada, setCajaInicializada] = useState(false);
  if (mostrarCaja && !cajaInicializada && propio !== null) {
    // El turno propio viene puesto: es el caso de casi todos los gastos en efectivo.
    setCashboxSessionId(propio.id);
    setCajaInicializada(true);
  }

  const createExpense = useCreateExpense();
  const updateExpense = useUpdateExpense();
  const busy = createExpense.isPending || updateExpense.isPending;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorApi(null);
    const parsed = expenseFormSchema.safeParse({
      expenseDate,
      categoryId,
      description,
      beneficiary,
      reference,
      accountRef,
      dueDate,
      notes,
    });
    const nuevos: Errores = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const campo = issue.path[0] as keyof Errores | undefined;
        if (campo && !nuevos[campo]) nuevos[campo] = t(issue.message);
      }
    }
    const monto = parseMoneyInput(amount);
    if (moneyInputError(amount) !== null || monto === null || monto <= 0) {
      nuevos.amount = t("expenses.form.errors.amount");
    }
    const descuento = discount.trim() === "" ? 0 : parseMoneyInput(discount);
    if (moneyInputError(discount) !== null || descuento === null) {
      nuevos.discount = t("expenses.form.errors.amount");
    }
    setErrores(nuevos);
    if (!parsed.success || Object.keys(nuevos).length > 0 || monto === null || descuento === null) {
      return;
    }
    const valores = parsed.data;
    const onError = (apiError: ApiError) => setErrorApi(apiError.message);

    if (!editando) {
      const input: CreateExpenseInput = {
        expenseDate: valores.expenseDate,
        categoryId: valores.categoryId,
        description: valores.description,
        amount: monto,
        discount: descuento,
        ...(supplierId !== null ? { supplierId } : {}),
        ...(supplierId === null && valores.beneficiary ? { beneficiary: valores.beneficiary } : {}),
        ...(valores.reference ? { reference: valores.reference } : {}),
        ...(taxGroupId !== null ? { taxGroupId } : {}),
        ...(pago !== "" ? { paymentMethod: pago } : {}),
        ...(pago === "cash" && cashboxSessionId !== "" ? { cashboxSessionId } : {}),
        ...(valores.accountRef ? { accountRef: valores.accountRef } : {}),
        ...(pago === "" && valores.dueDate ? { dueDate: valores.dueDate } : {}),
        ...(valores.notes ? { notes: valores.notes } : {}),
      };
      createExpense.mutate(input, { onSuccess: onDone, onError });
      return;
    }

    // Solo lo que cambió: vacío pasa a null (se limpia), igual no viaja.
    const cambios: UpdateExpenseInput = {};
    if (valores.expenseDate !== expense.expenseDate) cambios.expenseDate = valores.expenseDate;
    if (valores.categoryId !== expense.categoryId) cambios.categoryId = valores.categoryId;
    if (valores.description !== expense.description) cambios.description = valores.description;
    if (supplierId !== expense.supplierId) cambios.supplierId = supplierId;
    const benef = supplierId === null ? valores.beneficiary || null : null;
    if (benef !== expense.beneficiary) cambios.beneficiary = benef;
    const ref = valores.reference || null;
    if (ref !== expense.reference) cambios.reference = ref;
    const cuenta = valores.accountRef || null;
    if (cuenta !== expense.accountRef) cambios.accountRef = cuenta;
    const vence = valores.dueDate || null;
    if (vence !== expense.dueDate) cambios.dueDate = vence;
    const notas = valores.notes || null;
    if (notas !== expense.notes) cambios.notes = notas;
    if (!pagado) {
      if (monto !== Number(expense.amount)) cambios.amount = monto;
      if (descuento !== Number(expense.discount)) cambios.discount = descuento;
      if (taxGroupId !== null) cambios.taxGroupId = taxGroupId;
    }
    if (Object.keys(cambios).length === 0) {
      onDone();
      return;
    }
    updateExpense.mutate({ id: expense.id, input: cambios }, { onSuccess: onDone, onError });
  };

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {errorApi && <ErrorNotice>{errorApi}</ErrorNotice>}
      {pagado && (
        <p className="text-muted-foreground text-sm">{t("expenses.form.paidImmutable")}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <DateField
          label={t("expenses.form.date")}
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          error={errores.expenseDate}
          required
        />
        <SelectField
          label={t("expenses.form.category")}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          error={errores.categoryId}
          options={[
            { value: "", label: t("expenses.form.categoryPlaceholder") },
            ...(categorias.data?.rows ?? []).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>

      {/* A quién se le pagó: UNA respuesta. Elegir un proveedor deshabilita el
          beneficiario libre, y escribir un beneficiario deshabilita el picker. */}
      <fieldset className="flex flex-col gap-3" data-testid="expense-payee">
        <legend className="font-medium text-sm">{t("expenses.form.payee")}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <SupplierPicker
            value={supplierId}
            onChange={(s) => setSupplierId(s?.id ?? null)}
            disabled={beneficiary.trim() !== ""}
            label={t("expenses.form.supplier")}
          />
          <TextField
            label={t("expenses.form.beneficiary")}
            hint={t("expenses.form.beneficiaryHint")}
            value={beneficiary}
            disabled={supplierId !== null}
            onChange={(e) => setBeneficiary(e.target.value)}
          />
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <MoneyField
          label={t("expenses.form.amount")}
          hint={t("expenses.form.amountHint")}
          value={amount}
          onChange={setAmount}
          error={errores.amount}
          disabled={pagado}
        />
        <MoneyField
          label={t("expenses.form.discount")}
          value={discount}
          onChange={setDiscount}
          error={errores.discount}
          disabled={pagado}
        />
        <TaxGroupSelect value={taxGroupId} onChange={setTaxGroupId} disabled={pagado} />
        <TextField
          label={t("expenses.form.reference")}
          hint={t("expenses.form.referenceHint")}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>

      {/* El pago solo al crear: después se paga desde la ficha, una sola vez. */}
      {!editando && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("expenses.form.payment")}
            value={pago}
            onChange={(e) => setPago(e.target.value as Pago)}
            options={[
              { value: "", label: t("expenses.form.paymentPending") },
              ...PAYMENT_METHODS.map((m) => ({ value: m, label: t(`pos.payment.${m}`) })),
            ]}
          />
          {pago === "" ? (
            <DateField
              label={t("expenses.form.dueDate")}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              error={errores.dueDate}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor="expense-account" className="font-medium text-sm">
                {t("expenses.form.account")}
              </label>
              <input
                id="expense-account"
                list="expense-accounts"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={accountRef}
                onChange={(e) => setAccountRef(e.target.value)}
              />
              <datalist id="expense-accounts">
                {(cuentas.data ?? []).map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <p className="text-muted-foreground text-xs">{t("expenses.form.accountHint")}</p>
            </div>
          )}
          {mostrarCaja && (
            <SelectField
              label={t("expenses.form.cashbox")}
              hint={t("expenses.form.cashboxHint")}
              value={cashboxSessionId}
              onChange={(e) => setCashboxSessionId(e.target.value)}
              options={[
                { value: "", label: t("expenses.form.cashboxNone") },
                ...(propio !== null
                  ? [
                      {
                        value: propio.id,
                        label: t("expenses.form.cashboxOwn", { warehouse: propio.warehouse.name }),
                      },
                    ]
                  : []),
                ...(puedeVerOtros
                  ? (abiertos.data?.rows ?? [])
                      .filter((s) => s.id !== propio?.id && s.openedBy.id !== userId)
                      .map((s) => ({
                        value: s.id,
                        label: t("expenses.form.cashboxOther", {
                          name: s.openedBy.name,
                          warehouse: s.warehouse.name,
                        }),
                      }))
                  : []),
              ]}
            />
          )}
        </div>
      )}
      {editando && (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("expenses.form.account")}
            hint={t("expenses.form.accountHint")}
            value={accountRef}
            onChange={(e) => setAccountRef(e.target.value)}
          />
          {!pagado && (
            <DateField
              label={t("expenses.form.dueDate")}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              error={errores.dueDate}
            />
          )}
        </div>
      )}

      <TextField
        label={t("expenses.form.description")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        error={errores.description}
        required
      />
      <TextField
        label={t("expenses.form.notes")}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
