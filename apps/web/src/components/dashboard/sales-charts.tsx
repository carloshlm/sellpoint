import { useTranslation } from "react-i18next";
import { ChartBars } from "@/components/dashboard/chart-bars";
import { ChartLine } from "@/components/dashboard/chart-line";
import { usePermissions } from "@/lib/auth/permissions";
import { useDashboardSeries } from "@/lib/dashboard/hooks";

/**
 * F5-DASH-11 — las dos gráficas de ventas: el mes contra el anterior (la
 * tendencia de un vistazo, con el mes pasado atenuado como referencia) y las
 * ventas de HOY por hora (la hora pico salta sola). Mismo gate que la fila
 * de KPIs: sin `reports:read` no hay gráfica ni petición.
 */
function SalesCharts() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const puedeVer = has("reports:read");
  const { data } = useDashboardSeries(puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  const porDia = data.byDay.map((d) => ({
    day: String(d.day),
    [t("dashboard.charts.current")]: Number(d.current),
    [t("dashboard.charts.previous")]: Number(d.previous),
  }));
  const porHora = data.byHour.map((h) => ({
    hour: `${h.hour}`,
    total: Number(h.total),
  }));
  const sinVentasHoy = data.byHour.every((h) => Number(h.total) === 0);
  // Mismo criterio que el donut: un mes entero en cero (negocio recién
  // nacido) pintaría una línea plana que parece bug — vacío honesto.
  const sinVentasMes = data.byDay.every((d) => Number(d.current) === 0 && Number(d.previous) === 0);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.charts.monthVsPrev")}</h2>
        <ChartLine
          label={t("dashboard.charts.monthVsPrev")}
          data={sinVentasMes ? [] : porDia}
          xKey="day"
          lines={[
            { dataKey: t("dashboard.charts.current"), token: "primary" },
            { dataKey: t("dashboard.charts.previous"), token: "muted" },
          ]}
        />
      </section>
      <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.charts.byHour")}</h2>
        <ChartBars
          label={t("dashboard.charts.byHour")}
          // Un día sin ventas: 24 barras de cero parecen un bug — vacío honesto.
          data={sinVentasHoy ? [] : porHora}
          xKey="hour"
          barKey="total"
        />
      </section>
    </div>
  );
}

export { SalesCharts };
