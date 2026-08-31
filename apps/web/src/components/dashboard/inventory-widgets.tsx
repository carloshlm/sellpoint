import type { Currency } from "@sellpoint/shared";
import { formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import { useDashboardInventory } from "@/lib/dashboard/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-DASH-13 — la salud del inventario: tres contadores CLICKEABLES (llevan
 * al reporte de stock ya filtrado) y la lista predictiva de atención. Gate:
 * `inventory:read` — es de quien opera el almacén; el VALOR (dinero) solo
 * llega del API si además hay `reports:read`, y acá simplemente no se pinta
 * lo que no llegó.
 */
function InventoryWidgets() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const currency = (useAuthStore((s) => s.user?.tenant.currency) ?? "MXN") as Currency;
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const puedeVer = has("inventory:read");
  const { data } = useDashboardInventory(puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium text-sm">{t("dashboard.inventory.title")}</h2>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Link
          to="/reports/stock"
          search={{ belowMin: true }}
          className="flex flex-col rounded-md border p-3 transition-colors hover:bg-muted"
        >
          <span className="font-semibold text-2xl text-destructive tabular-nums">
            {data.outOfStock}
          </span>
          <span className="text-muted-foreground text-xs">
            🔴 {t("dashboard.inventory.outOfStock")}
          </span>
        </Link>
        <Link
          to="/reports/stock"
          search={{ belowMin: true }}
          className="flex flex-col rounded-md border p-3 transition-colors hover:bg-muted"
        >
          <span className="font-semibold text-2xl text-warning tabular-nums">{data.belowMin}</span>
          <span className="text-muted-foreground text-xs">
            🟠 {t("dashboard.inventory.belowMin")}
          </span>
        </Link>
        {data.inventoryValue !== undefined && (
          <Link
            to="/reports/stock"
            className="flex flex-col rounded-md border p-3 transition-colors hover:bg-muted"
          >
            <span className="font-semibold text-2xl tabular-nums">
              {formatMoney(Number(data.inventoryValue), currency, locale)}
            </span>
            <span className="text-muted-foreground text-xs">
              💰 {t("dashboard.inventory.value")}
            </span>
          </Link>
        )}
      </div>
      <h3 className="text-muted-foreground text-xs uppercase">
        {t("dashboard.inventory.attention")}
      </h3>
      {data.attention.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("dashboard.inventory.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {data.attention.map((producto) => (
            <li key={producto.productId} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{producto.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {Number(producto.stock)}/{Number(producto.stockMin)}
              </span>
              <span
                className={
                  producto.daysLeft !== null && producto.daysLeft <= 3
                    ? "text-destructive text-xs tabular-nums"
                    : "text-warning text-xs tabular-nums"
                }
              >
                {producto.daysLeft === null
                  ? t("dashboard.inventory.noPace")
                  : t("dashboard.inventory.daysLeft", { days: producto.daysLeft })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export { InventoryWidgets };
