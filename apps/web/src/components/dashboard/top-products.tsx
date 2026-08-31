import type { Currency } from "@sellpoint/shared";
import { formatMoney } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import type { DashboardPeriod } from "@/lib/dashboard/api";
import { useDashboardProducts } from "@/lib/dashboard/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-DASH-12 — los dos tops lado a lado: qué se VENDE y qué DEJA. Dos listas
 * a propósito — vender mucho no es ganar mucho, y verlas juntas es donde el
 * dueño descubre a su producto estrella real.
 */
function TopProducts({ period }: { period: DashboardPeriod }) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const puedeVer = has("reports:read");
  const { data } = useDashboardProducts(period, puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const vacio = <p className="text-muted-foreground text-sm">{t("dashboard.top.empty")}</p>;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.top.sold")}</h2>
        {data.topSold.length === 0 ? (
          vacio
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {data.topSold.map((producto, i) => (
              <li key={producto.productId} className="flex items-center gap-2">
                <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{producto.name}</span>
                {producto.deltaPct !== null && producto.deltaPct !== 0 && (
                  <span
                    className={
                      producto.deltaPct > 0 ? "text-success text-xs" : "text-destructive text-xs"
                    }
                  >
                    {producto.deltaPct > 0 ? "▲" : "▼"} {Math.abs(producto.deltaPct)}%
                  </span>
                )}
                <span className="text-muted-foreground tabular-nums">
                  {Number(producto.units)} {t("dashboard.top.units").toLowerCase()}
                </span>
                <span className="w-24 text-right tabular-nums">{dinero(producto.revenue)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section className="flex flex-col gap-2 rounded-lg border bg-card p-4">
        <h2 className="font-medium text-sm">{t("dashboard.top.profit")}</h2>
        {data.topProfit.length === 0 ? (
          vacio
        ) : (
          <ol className="flex flex-col gap-1 text-sm">
            {data.topProfit.map((producto, i) => (
              <li key={producto.productId} className="flex items-center gap-2">
                <span className="w-5 text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{producto.name}</span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {producto.marginPct}% {t("dashboard.top.margin").toLowerCase()}
                </span>
                <span className="w-24 text-right tabular-nums">{dinero(producto.profit)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

export { TopProducts };
