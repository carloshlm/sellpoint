import { useTranslation } from "react-i18next";
import { ChartDonut } from "@/components/dashboard/chart-donut";
import { useAdminTenantScope } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import type { DashboardPeriod } from "@/lib/dashboard/api";
import { useDashboardPayments } from "@/lib/dashboard/hooks";

/** F5-DASH-14 — el donut de métodos de pago del período, con su leyenda %. */
function PaymentDonut({ period }: { period: DashboardPeriod }) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { forcePermission } = useAdminTenantScope();
  const puedeVer = forcePermission || has("reports:read");
  const { data } = useDashboardPayments(period, puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  const segmentos = data.methods.map((m) => ({
    name: t(`dashboard.payments.${m.method}`),
    value: m.pct,
  }));

  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-4">
      <h2 className="font-medium text-sm">{t("dashboard.payments.title")}</h2>
      <ChartDonut
        label={t("dashboard.payments.title")}
        data={segmentos}
        height={200}
        // Los segmentos son porcentajes: «Efectivo: 60.9» pelón parece un
        // importe — el símbolo dice de qué habla (Carlos, 2026-08-31).
        formatValue={(valor) => `${valor}%`}
      />
      {data.methods.length > 0 && (
        <ul className="flex flex-wrap gap-3 text-sm">
          {data.methods.map((m) => (
            <li key={m.method} className="text-muted-foreground">
              {t(`dashboard.payments.${m.method}`)}:{" "}
              <span className="text-foreground tabular-nums">{m.pct}%</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { PaymentDonut };
