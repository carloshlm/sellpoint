import { formatMoney } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import { useDashboardKpis } from "@/lib/dashboard/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-DASH-10 — los cuatro números de arriba: hoy, mes (con meta), utilidad y
 * tickets. Se auto-gatea con `reports:read` (patrón ExpiringCard): sin el
 * permiso no hay tarjetas NI petición — los números del negocio no son del
 * mostrador. Mientras carga no pinta esqueletos: la fila aparece completa o
 * no aparece, sin bailes de layout.
 */
function KpiRow() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const currency = useScopedCurrency();
  // El locale de la CUENTA, tipado — mismo criterio que sales-report.
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const { forcePermission } = useAdminTenantScope();
  const puedeVer = forcePermission || has("reports:read");
  const { data } = useDashboardKpis(puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label={t("dashboard.kpi.salesToday")}
        value={dinero(data.today.total)}
        deltaPct={data.today.deltaVsLastWeekPct}
      />
      <KpiCard
        label={t("dashboard.kpi.salesMonth")}
        value={dinero(data.month.total)}
        deltaPct={data.month.deltaVsPrevMonthPct}
        goalPct={data.month.goalPct}
      />
      <KpiCard
        label={t("dashboard.kpi.profitMonth")}
        value={data.profit.month === null ? null : dinero(data.profit.month)}
        deltaPct={data.profit.deltaVsPrevMonthPct}
        detail={data.profit.month === null ? t("dashboard.kpi.profitPending") : undefined}
      />
      <KpiCard
        label={t("dashboard.kpi.ticketsToday")}
        value={String(data.today.tickets)}
        detail={
          data.today.averageTicket === null
            ? undefined
            : t("dashboard.kpi.averageTicket", { value: dinero(data.today.averageTicket) })
        }
      />
    </div>
  );
}

export { KpiRow };
