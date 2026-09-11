import { type Currency, formatMoney } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import type { ListExpensesParams } from "@/lib/expenses/api";
import { useExpenseSummary } from "@/lib/expenses/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F9-EXP-13 — el resumen del filtro vigente, en SU consulta
 * (`/expenses/summary`): el total no cambia al cambiar de página, y un
 * anulado no cuenta. Sin gastos no se pinta.
 */
export function ExpensesSummaryBar({
  filters,
}: {
  filters: Omit<ListExpensesParams, "page" | "pageSize">;
}) {
  const { t } = useTranslation();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const { data } = useExpenseSummary(filters);
  if (data === undefined || data.count === 0) return null;
  const dinero = (v: string) => formatMoney(Number(v), currency, locale);

  return (
    <section
      data-testid="expenses-summary"
      className="grid gap-3 rounded-md border border-input p-3 text-sm sm:grid-cols-4"
    >
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">
          {t("expenses.summary.count", { count: data.count })}
        </span>
        <span className="font-semibold text-lg tabular-nums" data-testid="expenses-summary-total">
          {dinero(data.total)}
        </span>
      </div>
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">{t("expenses.summary.tax")}</span>
        <span className="tabular-nums">{dinero(data.tax)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">{t("expenses.summary.pending")}</span>
        <span className="tabular-nums">{dinero(data.byPaymentStatus.pending)}</span>
      </div>
      <div className="flex flex-col">
        <span className="text-muted-foreground text-xs">{t("expenses.summary.paid")}</span>
        <span className="tabular-nums">{dinero(data.byPaymentStatus.paid)}</span>
      </div>
      {data.byCategory.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs sm:col-span-4">
          {data.byCategory.slice(0, 6).map((c) => (
            <li key={c.categoryId}>
              {c.categoryName}: <span className="tabular-nums">{dinero(c.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
