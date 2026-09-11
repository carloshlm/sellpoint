import { type Currency, formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { ExpensesSummaryBar } from "@/components/expenses/expenses-summary-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Paginator } from "@/components/ui/paginator";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import {
  downloadExpenses,
  type ExpensePaymentStatus,
  type ExpenseStatus,
} from "@/lib/expenses/api";
import { useExpenseCategories } from "@/lib/expenses/categories-hooks";
import { useExpenses } from "@/lib/expenses/hooks";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useAuthStore } from "@/stores/auth.store";

const BOTON_PRIMARIO =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring";

/**
 * F9-EXP-13 — el listado de gastos (molde: `sales-history.tsx`): buscador con
 * debounce, estado, estado de pago, categoría y rango de fechas del negocio;
 * el resumen del filtro en su propia consulta; los anulados se ven marcados.
 * El cargando y el error van DENTRO del JSX, no en un `return` temprano:
 * cambiar un filtro no puede borrar la barra que el usuario está tocando.
 */
export function ExpensesList() {
  const { t, i18n } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canManage = has("expenses:manage") && canWrite;

  const [texto, setTexto] = useState("");
  const termino = useDebouncedValue(texto.trim());
  const [estado, setEstado] = useState<"todos" | ExpenseStatus>("todos");
  const [pago, setPago] = useState<"todos" | ExpensePaymentStatus>("todos");
  const [categoria, setCategoria] = useState("");
  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });
  const [pagina, setPagina] = useState(1);
  const [exportando, setExportando] = useState(false);

  const filtros = {
    ...(termino !== "" && { query: termino }),
    ...(estado !== "todos" && { status: estado }),
    ...(pago !== "todos" && { paymentStatus: pago }),
    ...(categoria !== "" && { categoryId: categoria }),
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
  };
  const { data, isPending, error } = useExpenses({ ...filtros, page: pagina, pageSize: 20 });
  const categorias = useExpenseCategories({ pageSize: 100 });
  const uiLocale = i18n.language;

  const cambiar =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      // Cualquier filtro vuelve a la página 1: quedarse en la 3 de un filtro
      // que ahora tiene una sola página muestra una tabla vacía que parece un bug.
      setPagina(1);
    };

  return (
    <section className="flex flex-col gap-4" data-testid="expenses-list">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("expenses.list.title")}</h1>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={exportando}
            onClick={() => {
              setExportando(true);
              void downloadExpenses({ ...filtros, format: "xlsx" }).finally(() =>
                setExportando(false),
              );
            }}
          >
            {t("expenses.list.export")}
          </Button>
          {canManage && (
            <Link to="/expenses/new" className={BOTON_PRIMARIO}>
              {t("expenses.list.new")}
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="expenses-search" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("expenses.list.search")}</span>
          <input
            id="expenses-search"
            type="search"
            className="h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
            value={texto}
            placeholder={t("expenses.list.searchPlaceholder")}
            onChange={(e) => cambiar(setTexto)(e.target.value)}
          />
        </label>
        <label htmlFor="expenses-status" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("expenses.list.status")}</span>
          <select
            id="expenses-status"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={estado}
            onChange={(e) => cambiar(setEstado)(e.target.value as typeof estado)}
          >
            <option value="todos">{t("expenses.list.statusAll")}</option>
            <option value="active">{t("expenses.status.active")}</option>
            <option value="canceled">{t("expenses.status.canceled")}</option>
          </select>
        </label>
        <label htmlFor="expenses-payment" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("expenses.list.paymentStatus")}</span>
          <select
            id="expenses-payment"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={pago}
            onChange={(e) => cambiar(setPago)(e.target.value as typeof pago)}
          >
            <option value="todos">{t("expenses.list.paymentAll")}</option>
            <option value="pending">{t("expenses.paymentStatusLabel.pending")}</option>
            <option value="paid">{t("expenses.paymentStatusLabel.paid")}</option>
          </select>
        </label>
        <label htmlFor="expenses-category" className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">{t("expenses.list.category")}</span>
          <select
            id="expenses-category"
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={categoria}
            onChange={(e) => cambiar(setCategoria)(e.target.value)}
          >
            <option value="">{t("expenses.list.categoryAll")}</option>
            {(categorias.data?.rows ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <DateRangeFilter
          id="expenses"
          from={rango.from}
          to={rango.to}
          onChange={cambiar(setRango)}
        />
      </div>

      <ExpensesSummaryBar filters={filtros} />

      {isPending ? (
        <p role="status">{t("common.form.loading")}</p>
      ) : error !== null ? (
        <p role="alert" className="text-destructive text-sm">
          {error.message}
        </p>
      ) : data?.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("expenses.list.empty")}</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                <th className="p-2">{t("expenses.list.columns.folio")}</th>
                <th className="p-2">{t("expenses.list.columns.date")}</th>
                <th className="p-2">{t("expenses.list.columns.category")}</th>
                <th className="p-2">{t("expenses.list.columns.payee")}</th>
                <th className="p-2">{t("expenses.list.columns.description")}</th>
                <th className="p-2 text-right">{t("expenses.list.columns.total")}</th>
                <th className="p-2">{t("expenses.list.columns.payment")}</th>
                <th className="p-2">{t("expenses.list.columns.status")}</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(data?.rows ?? []).map((gasto) => {
                const anulado = gasto.status === "canceled";
                return (
                  <tr
                    key={gasto.id}
                    data-testid={`expense-${gasto.id}`}
                    className={`border-b ${TABLE_ROW_HOVER} ${anulado ? "text-muted-foreground line-through decoration-muted-foreground/40" : ""}`}
                  >
                    <td className="p-2 font-medium tabular-nums whitespace-nowrap">
                      {gasto.folio}
                    </td>
                    <td className="p-2 tabular-nums">
                      {formatCalendarDate(gasto.expenseDate, uiLocale)}
                    </td>
                    <td className="p-2">{gasto.categoryName}</td>
                    <td className="p-2">
                      {gasto.supplierName ?? gasto.beneficiary ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="max-w-64 truncate p-2" title={gasto.description}>
                      {gasto.description}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {formatMoney(Number(gasto.total), currency, locale)}
                    </td>
                    <td className="p-2">
                      <Badge variant={gasto.paymentStatus === "paid" ? "success" : "warning"}>
                        {t(`expenses.paymentStatusLabel.${gasto.paymentStatus}`)}
                      </Badge>
                    </td>
                    <td className="p-2">
                      <Badge variant={anulado ? "destructive" : "success"}>
                        {t(`expenses.status.${gasto.status}`)}
                      </Badge>
                    </td>
                    <td className="p-2 text-right">
                      <Link
                        to="/expenses/$expenseId"
                        params={{ expenseId: gasto.id }}
                        className="inline-flex h-8 items-center px-3 font-medium text-primary text-sm hover:underline"
                      >
                        {t("expenses.list.view")}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      )}

      <Paginator
        page={pagina}
        pageSize={data?.pageSize ?? 20}
        total={data?.total ?? 0}
        onPageChange={setPagina}
      />
    </section>
  );
}
