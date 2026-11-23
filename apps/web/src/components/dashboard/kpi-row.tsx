import { formatMoney } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
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
  // F9-EXP-11: la utilidad NETA solo tiene sentido con el módulo de Gastos;
  // sin él, la tarjeta no existe (no una neta igual a la bruta que confunda).
  const { hasModule } = usePlan();
  const conGastos = hasModule("expenses");

  if (!puedeVer || data === undefined) {
    return null;
  }

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);

  // F10-KPI-07 — «¿voy a llegar?». Cada renglón calla sin su dato (null o un
  // API anterior que no lo manda). La meta alcanzada se decide con los montos,
  // no con requiredDaily: lo que falta puede redondear a $0.00 sin haber llegado.
  const { projected, requiredDaily, goal } = data.month;
  const metaAlcanzada = goal !== null && Number(data.month.total) >= Number(goal);
  const renglonesMes = [
    ...(projected == null ? [] : [t("dashboard.kpi.projected", { value: dinero(projected) })]),
    ...(requiredDaily == null
      ? []
      : [
          metaAlcanzada
            ? t("dashboard.kpi.goalReached")
            : t("dashboard.kpi.requiredDaily", { value: dinero(requiredDaily) }),
        ]),
  ];
  const { marginPct } = data.profit;

  // F10-KPI-08 — el punto de equilibrio explica la neta; sin gastos (sin
  // avance que medir) el mosaico queda como antes.
  const equilibrio = data.profit.breakEven;
  const cubierto =
    data.profit.netMonth !== null && equilibrio !== undefined && equilibrio.coveredPct !== null
      ? equilibrio
      : null;

  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${conGastos ? "xl:grid-cols-5" : "xl:grid-cols-4"}`}>
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
        details={renglonesMes}
      />
      <KpiCard
        label={t("dashboard.kpi.profitMonth")}
        value={data.profit.month === null ? null : dinero(data.profit.month)}
        deltaPct={data.profit.deltaVsPrevMonthPct}
        detail={
          data.profit.month === null
            ? t("dashboard.kpi.profitPending")
            : marginPct == null
              ? undefined
              : t("dashboard.kpi.margin", { pct: marginPct })
        }
      />
      {conGastos && (
        <KpiCard
          label={t("dashboard.kpi.netProfitMonth")}
          value={data.profit.netMonth === null ? null : dinero(data.profit.netMonth)}
          deltaPct={data.profit.netDeltaVsPrevMonthPct}
          detail={data.profit.netMonth === null ? t("dashboard.kpi.profitPending") : undefined}
          progress={
            cubierto === null
              ? undefined
              : {
                  pct: cubierto.coveredPct,
                  label: t("dashboard.kpi.expensesCovered", { pct: cubierto.coveredPct }),
                }
          }
          details={
            cubierto === null
              ? undefined
              : cubierto.coveredOnDay !== null
                ? [t("dashboard.kpi.coveredSince", { day: cubierto.coveredOnDay })]
                : cubierto.remainingSales !== null
                  ? [t("dashboard.kpi.remainingSales", { value: dinero(cubierto.remainingSales) })]
                  : undefined
          }
        />
      )}
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
