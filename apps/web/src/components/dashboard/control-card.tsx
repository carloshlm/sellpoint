import { formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SalesFiltersInitial } from "@/components/reports/sales-filters";
import type { ShiftsFiltersInitial } from "@/components/reports/shifts-report";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import type { DashboardPeriod } from "@/lib/dashboard/api";
import { useDashboardControl } from "@/lib/dashboard/hooks";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

/** Los dos reportes a los que lleva la tarjeta, con sus filtros de la URL. */
type Destino =
  | { to: "/reports/shifts"; search: ShiftsFiltersInitial }
  | { to: "/reports/sales"; search: SalesFiltersInitial };

interface ContadorProps {
  etiqueta: string;
  importe: string;
  /** El color cuando hay algo que revisar; en cero, el importe va neutro. */
  tono: "text-destructive" | "text-warning";
  activo: boolean;
  detalles: string[];
  /** A dónde lleva; sin enlace (el expediente del backoffice), se lee sin navegar. */
  enlace: Destino | null;
}

/** Un contador: su etiqueta, el importe y sus renglones menores. */
function Contador({ etiqueta, importe, tono, activo, detalles, enlace }: ContadorProps) {
  const contenido: ReactNode = (
    <>
      <span className="text-muted-foreground text-xs">{etiqueta}</span>
      <span className={cn("font-semibold text-2xl tabular-nums", activo && tono)}>{importe}</span>
      {detalles.map((detalle) => (
        <span key={detalle} className="text-muted-foreground text-xs">
          {detalle}
        </span>
      ))}
    </>
  );
  const clase = "flex min-w-0 flex-col rounded-md border p-3";
  const claseEnlace = cn(clase, "transition-colors hover:bg-muted");
  if (enlace === null) {
    return <div className={clase}>{contenido}</div>;
  }
  if (enlace.to === "/reports/shifts") {
    return (
      <Link to={enlace.to} search={enlace.search} className={claseEnlace}>
        {contenido}
      </Link>
    );
  }
  return (
    <Link to={enlace.to} search={enlace.search} className={claseEnlace}>
      {contenido}
    </Link>
  );
}

/**
 * F10-KPI-15 — «Control»: los faltantes de caja, los descuentos y las
 * cancelaciones del periodo de las pestañas. Tres números que hoy exigen abrir
 * tres reportes y sumar a mano; cada contador lleva a su reporte YA filtrado
 * con las fechas del periodo (las del calendario del negocio, que manda el API).
 *
 * Los sobrantes van en un renglón menor y nunca restan a los faltantes. En
 * cero, cada contador dice 0 en color neutro: no hay nada que revisar.
 *
 * Las cancelaciones cuentan por su fecha de cancelación y el reporte de Ventas
 * filtra por la fecha de la venta: casi siempre coinciden (se cancela el mismo
 * día), y una venta cancelada en otro periodo aparece en el de su venta.
 *
 * Gate: `reports:read` en `enabled` (sin él, el dato ni se pide). Desde el
 * expediente del backoffice carga por el espejo y no enlaza: los reportes del
 * negocio mirado viven en otra pestaña, y `/reports/...` abriría los propios.
 */
function ControlCard({ period }: { period: DashboardPeriod }) {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const { forcePermission, tenantId } = useAdminTenantScope();
  const puedeVer = forcePermission || has("reports:read");
  const { data } = useDashboardControl(period, puedeVer);

  if (!puedeVer || data === undefined) {
    return null;
  }

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const enlaza = tenantId === null;
  const { from, to } = data.range;
  const { shortage, overage } = data.cash;
  const { discounts, cancellations } = data;

  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4">
      <h2 className="font-medium text-sm">{t("dashboard.control.title")}</h2>
      <div className="grid gap-2 sm:grid-cols-3">
        <Contador
          etiqueta={t("dashboard.control.shortage")}
          importe={dinero(shortage.amount)}
          tono="text-destructive"
          activo={Number(shortage.amount) > 0}
          detalles={[
            t("dashboard.control.shortageShifts", { count: shortage.shifts }),
            t("dashboard.control.overage", { amount: dinero(overage.amount) }),
          ]}
          enlace={
            enlaza ? { to: "/reports/shifts", search: { difference: "shortage", from, to } } : null
          }
        />
        <Contador
          etiqueta={t("dashboard.control.discounts")}
          importe={dinero(discounts.amount)}
          tono="text-warning"
          activo={Number(discounts.amount) > 0}
          detalles={[
            [
              ...(discounts.pctOfSales === null
                ? []
                : [t("dashboard.control.pctOfSales", { pct: discounts.pctOfSales })]),
              t("dashboard.control.tickets", { count: discounts.tickets }),
            ].join(" · "),
          ]}
          enlace={
            enlaza
              ? {
                  to: "/reports/sales",
                  search: { status: "completed", discounted: true, from, to },
                }
              : null
          }
        />
        <Contador
          etiqueta={t("dashboard.control.cancellations")}
          importe={dinero(cancellations.amount)}
          tono="text-warning"
          activo={cancellations.count > 0}
          detalles={[t("dashboard.control.sales", { count: cancellations.count })]}
          enlace={
            enlaza ? { to: "/reports/sales", search: { status: "canceled", from, to } } : null
          }
        />
      </div>
    </section>
  );
}

export { ControlCard };
