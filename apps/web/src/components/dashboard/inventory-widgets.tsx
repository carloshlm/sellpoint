import { formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollableList } from "@/components/ui/scrollable-list";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import { useDashboardInventory } from "@/lib/dashboard/hooks";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F5-DASH-13 — la salud del inventario: tres contadores CLICKEABLES (llevan
 * al reporte de stock ya filtrado) y la lista predictiva de atención. Gate:
 * `inventory:read` — es de quien opera el almacén; el VALOR (dinero) solo
 * llega del API si además hay `reports:read`, y acá simplemente no se pinta
 * lo que no llegó.
 *
 * F10-PEND-06: las columnas las decide el ancho de la TARJETA (`@container`),
 * no el de la pantalla: a 1280 px con el menú abierto la tarjeta mide media
 * pantalla y en tres columnas «$53,853.00» se salía de su mosaico. Mientras no
 * caben tres, el valor ocupa su propio renglón; y si un número enorme aún no
 * cabe, se parte antes que salirse.
 *
 * F10-PEND-07: en el expediente del backoffice los contadores se leen SIN
 * enlace, como «Control»: `/reports/stock` es el reporte del negocio propio, y
 * el del negocio mirado vive en la pestaña Reportes del expediente.
 */
function InventoryWidgets() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const { forcePermission, tenantId } = useAdminTenantScope();
  const enlaza = tenantId === null;
  const puedeVer = forcePermission || has("inventory:read");
  const { data } = useDashboardInventory(puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  return (
    <section className="@container flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium text-sm">{t("dashboard.inventory.title")}</h2>
      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-3">
        <Mosaico enlaza={enlaza} soloBajoMinimo>
          <span className="font-semibold text-2xl text-destructive tabular-nums">
            {data.outOfStock}
          </span>
          <span className="text-muted-foreground text-xs">
            🔴 {t("dashboard.inventory.outOfStock")}
          </span>
        </Mosaico>
        <Mosaico enlaza={enlaza} soloBajoMinimo>
          <span className="font-semibold text-2xl text-warning tabular-nums">{data.belowMin}</span>
          <span className="text-muted-foreground text-xs">
            🟠 {t("dashboard.inventory.belowMin")}
          </span>
        </Mosaico>
        {data.inventoryValue !== undefined && (
          <Mosaico enlaza={enlaza} className="col-span-2 @lg:col-span-1">
            <span className="wrap-anywhere font-semibold text-2xl tabular-nums">
              {formatMoney(Number(data.inventoryValue), currency, locale)}
            </span>
            <span className="text-muted-foreground text-xs">
              💰 {t("dashboard.inventory.value")}
            </span>
          </Mosaico>
        )}
      </div>
      <h3 className="text-muted-foreground text-xs uppercase">
        {t("dashboard.inventory.attention")}
      </h3>
      {data.attention.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("dashboard.inventory.empty")}</p>
      ) : (
        // Caja deslizable con `min-w`: en un celular las filas no caben y sin
        // scroll se cortaban en el borde (revisión móvil, Carlos 2026-08-31).
        <ScrollableList>
          <ul className="flex min-w-[24rem] flex-col gap-1 text-sm">
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
        </ScrollableList>
      )}
    </section>
  );
}

type MosaicoProps = {
  /** Sin enlace (el expediente del backoffice), el mosaico se lee sin navegar. */
  enlaza: boolean;
  /** Llega al reporte con «Solo bajo mínimo» puesto. */
  soloBajoMinimo?: boolean;
  className?: string;
  children: ReactNode;
};

function Mosaico({ enlaza, soloBajoMinimo = false, className = "", children }: MosaicoProps) {
  const clase = `flex min-w-0 flex-col rounded-md border p-3 ${className}`.trim();
  if (!enlaza) {
    return <div className={clase}>{children}</div>;
  }
  return (
    <Link
      to="/reports/stock"
      {...(soloBajoMinimo && { search: { belowMin: true } })}
      className={`${clase} transition-colors hover:bg-muted`}
    >
      {children}
    </Link>
  );
}

export { InventoryWidgets };
