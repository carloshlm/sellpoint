import { useTranslation } from "react-i18next";
import type { DashboardPeriod } from "@/lib/dashboard/api";
import { cn } from "@/lib/utils";

const PERIODS: { value: DashboardPeriod; labelKey: string }[] = [
  { value: "today", labelKey: "dashboard.period.today" },
  { value: "week", labelKey: "dashboard.period.week" },
  { value: "month", labelKey: "dashboard.period.month" },
  { value: "prev_month", labelKey: "dashboard.period.prevMonth" },
];

/**
 * F5-DASH-12 — el filtro global de período que gobierna tops y métodos de
 * pago. Estado de la PANTALLA (no de la URL): es una lente de lectura, no
 * una navegación que merezca historial.
 */
function PeriodFilter({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (period: DashboardPeriod) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset
      aria-label={t("dashboard.period.month")}
      className="flex flex-wrap gap-1 border-0 p-0"
    >
      {PERIODS.map((period) => (
        <button
          key={period.value}
          type="button"
          onClick={() => onChange(period.value)}
          aria-pressed={value === period.value}
          className={cn(
            "rounded-md border px-3 py-1 text-sm transition-colors",
            value === period.value
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {t(period.labelKey)}
        </button>
      ))}
    </fieldset>
  );
}

export { PeriodFilter };
