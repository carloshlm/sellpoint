import { formatMoney, localeToBcp47 } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { ChartBars } from "@/components/dashboard/chart-bars";
import { ChartLine } from "@/components/dashboard/chart-line";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import { useDashboardSeries } from "@/lib/dashboard/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-DASH-11 — las dos gráficas de ventas: el mes contra el anterior (la
 * tendencia de un vistazo, con el mes pasado atenuado como referencia) y las
 * ventas de HOY por hora (la hora pico salta sola), con el mismo día de las
 * últimas cuatro semanas como línea de fondo (F10-KPI-04). Mismo gate que la
 * fila de KPIs: sin `reports:read` no hay gráfica ni petición.
 */
function SalesCharts() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const { forcePermission } = useAdminTenantScope();
  const puedeVer = forcePermission || has("reports:read");
  const { data } = useDashboardSeries(puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  // Los dos ejes hablan de DINERO y sin símbolo no se nota (Carlos,
  // 2026-08-31): tooltip con centavos, eje sin ellos — en un eje, cinco
  // ticks terminados en `.00` son puro ruido.
  const dinero = (valor: number) => formatMoney(valor, currency, locale);
  const dineroEje = new Intl.NumberFormat(localeToBcp47(locale), {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  const porDia = data.byDay.map((d) => ({
    day: String(d.day),
    [t("dashboard.charts.current")]: Number(d.current),
    [t("dashboard.charts.previous")]: Number(d.previous),
  }));
  // F10-KPI-04: el mismo día de las últimas cuatro semanas, al fondo. Un API
  // anterior no lo manda y un negocio sin historia lo manda en null; un día
  // típico en puros ceros tampoco dice nada. En los tres casos, sin referencia.
  const conReferencia = data.byHour.some((h) => h.reference != null && Number(h.reference) > 0);
  const porHora = data.byHour.map((h) => ({
    hour: `${h.hour}`,
    total: Number(h.total),
    reference: conReferencia ? Number(h.reference ?? 0) : null,
  }));
  // Sin ventas todavía, la referencia sola ya dice a qué hora viene el pico.
  const porHoraVacia = !conReferencia && data.byHour.every((h) => Number(h.total) === 0);
  // Mismo criterio que el donut: un mes entero en cero (negocio recién
  // nacido) pintaría una línea plana que parece bug — vacío honesto.
  const sinVentasMes = data.byDay.every((d) => Number(d.current) === 0 && Number(d.previous) === 0);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.charts.monthVsPrev")}</h2>
        <ChartLine
          label={t("dashboard.charts.monthVsPrev")}
          data={sinVentasMes ? [] : porDia}
          xKey="day"
          lines={[
            { dataKey: t("dashboard.charts.current"), token: "primary" },
            { dataKey: t("dashboard.charts.previous"), token: "muted" },
          ]}
          formatValue={dinero}
          formatAxis={(valor) => dineroEje.format(valor)}
          // «Día 24» y no «24» (Carlos, 2026-09-01): el encabezado del
          // tooltip tiene que decir de qué habla.
          formatLabel={(dia) => t("dashboard.charts.dayLabel", { day: dia })}
        />
      </section>
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.charts.byHour")}</h2>
        <ChartBars
          label={t("dashboard.charts.byHour")}
          // Un día sin ventas ni referencia: 24 barras de cero parecen un bug —
          // vacío honesto.
          data={porHoraVacia ? [] : porHora}
          xKey="hour"
          barKey="total"
          barName={t("dashboard.charts.today")}
          referenceKey="reference"
          referenceName={t("dashboard.charts.sameDayLast4Weeks")}
          formatValue={dinero}
          formatAxis={(valor) => dineroEje.format(valor)}
          formatLabel={(hora) => t("dashboard.charts.hourLabel", { hour: hora })}
        />
      </section>
    </div>
  );
}

export { SalesCharts };
