import { formatMoney } from "@sellpoint/shared";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ShiftsFiltersInitial } from "@/components/reports/shifts-report";
import { Button } from "@/components/ui/button";
import { useAdminTenantScope, useScopedCurrency } from "@/lib/admin/scope";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import {
  useDashboardInventory,
  useDashboardKpis,
  useDashboardPayments,
  useDashboardProducts,
} from "@/lib/dashboard/hooks";
import { useAuthStore } from "@/stores/auth.store";

/** F10-KPI-17 — cuántos avisos se ven de entrada; el resto, tras «Ver N más». */
const A_LA_VISTA = 4;

/** A dónde lleva cada aviso (null: se lee, pero no enlaza). */
type Destino =
  | { to: "/reports/stock" | "/reports/sales" }
  | { to: "/reports/shifts"; search: ShiftsFiltersInitial }
  | { to: "/expenses"; search: { paymentStatus: "pending" } }
  | { to: "/dashboard"; hash: "margin-check" };

interface Aviso {
  key: string;
  texto: string;
  destino: Destino | null;
  tono: "rojo" | "ambar" | "verde";
}

const TONO = {
  rojo: "border-destructive/40",
  ambar: "border-warning/40",
  verde: "border-success/40",
} as const;

/**
 * F5-DASH-15 — las alertas inteligentes: frases ACCIONABLES compuestas con
 * datos que el panel ya cargó. Cero requests extra por construcción: estos
 * hooks comparten caché con los widgets de al lado (mismas query keys —
 * react-query deduplica), así que el bloque lee, no pide. Cada regla calla
 * cuando su dato no da la nota; sin ninguna, el bloque entero desaparece — un
 * título huérfano sería ruido.
 *
 * F10-KPI-17 — de cuatro reglas a nueve, ORDENADAS por urgencia: faltante de
 * caja, gastos vencidos, bajo costo, agotados, gastos por vencer, ventas
 * abajo, sin costo, producto que creció y método dominante. Se ven cuatro; con
 * más, «Ver N más» despliega el resto. Los avisos nuevos salen de `kpis`
 * (`attention`) y de `products` del mes: tampoco piden nada. Con un API
 * anterior (sin esos campos) callan, y el bloque queda como estaba.
 */
function AlertsBlock() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { hasModule } = usePlan();
  const { forcePermission } = useAdminTenantScope();
  const currency = useScopedCurrency();
  const locale = useAuthStore((s) => s.user?.locale ?? "es");
  const [desplegado, setDesplegado] = useState(false);
  const puedeVerDinero = forcePermission || has("reports:read");
  const puedeVerStock = forcePermission || has("inventory:read");

  const { data: kpis } = useDashboardKpis(puedeVerDinero);
  const { data: productos } = useDashboardProducts("month", puedeVerDinero);
  const { data: inventario } = useDashboardInventory(puedeVerStock);
  const { data: pagos } = useDashboardPayments("month", puedeVerDinero);

  const dinero = (valor: string) => formatMoney(Number(valor), currency, locale);
  const atencion = kpis?.attention;
  // Como la utilidad neta: el API calcula siempre, el panel lo dice solo con
  // el módulo de Gastos. Y enlaza al listado solo si la persona puede verlo.
  const conGastos = hasModule("expenses");
  const aGastos: Destino | null = has("expenses:read")
    ? { to: "/expenses", search: { paymentStatus: "pending" } }
    : null;
  // Bajo costo y sin costo llevan a los avisos de «Mayor utilidad», en esta
  // misma pantalla (F10-KPI-02).
  const aMargenes: Destino = { to: "/dashboard", hash: "margin-check" };

  const alertas: Aviso[] = [];

  const faltantes = atencion?.shiftShortages;
  if (faltantes !== undefined && faltantes.count > 0) {
    alertas.push({
      key: "caja-faltante",
      texto: `🔴 ${t("dashboard.alerts.shiftShortage", {
        count: faltantes.count,
        amount: dinero(faltantes.amount),
      })}`,
      // Las fechas son las de la cuenta del API (ayer y hoy, días del negocio).
      destino: {
        to: "/reports/shifts",
        search: { difference: "shortage", ...faltantes.range },
      },
      tono: "rojo",
    });
  }

  const porPagar = conGastos ? atencion?.payables : undefined;
  if (porPagar !== undefined && porPagar.overdueCount > 0) {
    alertas.push({
      key: "gastos-vencidos",
      texto: `🔴 ${t("dashboard.alerts.payablesOverdue", {
        count: porPagar.overdueCount,
        amount: dinero(porPagar.overdueAmount),
      })}`,
      destino: aGastos,
      tono: "rojo",
    });
  }

  const bajoCosto = productos?.belowCostCount ?? productos?.belowCost?.length ?? 0;
  if (bajoCosto > 0) {
    alertas.push({
      key: "bajo-costo",
      texto: `🔴 ${t("dashboard.alerts.belowCost", { count: bajoCosto })}`,
      destino: aMargenes,
      tono: "rojo",
    });
  }

  if (inventario !== undefined && inventario.outOfStock > 0) {
    alertas.push({
      key: "agotados",
      texto: `🔴 ${t("dashboard.alerts.outOfStock", { count: inventario.outOfStock })}`,
      destino: { to: "/reports/stock" },
      tono: "rojo",
    });
  }

  if (porPagar !== undefined && porPagar.dueSoonCount > 0) {
    alertas.push({
      key: "gastos-por-vencer",
      texto: `⚠️ ${t("dashboard.alerts.payablesDueSoon", {
        count: porPagar.dueSoonCount,
        amount: dinero(porPagar.dueSoonAmount),
      })}`,
      destino: aGastos,
      tono: "ambar",
    });
  }

  const deltaHoy = kpis?.today.deltaVsLastWeekPct ?? null;
  if (deltaHoy !== null && deltaHoy <= -10) {
    alertas.push({
      key: "ventas-abajo",
      texto: `⚠️ ${t("dashboard.alerts.salesDown", { pct: Math.abs(deltaHoy) })}`,
      destino: { to: "/reports/sales" },
      tono: "ambar",
    });
  }

  const sinCosto = productos?.uncostedCount ?? productos?.uncosted?.length ?? 0;
  if (sinCosto > 0) {
    alertas.push({
      key: "sin-costo",
      texto: `⚠️ ${t("dashboard.alerts.uncosted", { count: sinCosto })}`,
      destino: aMargenes,
      tono: "ambar",
    });
  }

  const estrella = productos?.topSold
    .filter((p) => p.deltaPct !== null && p.deltaPct >= 20)
    .sort((a, b) => (b.deltaPct ?? 0) - (a.deltaPct ?? 0))[0];
  if (estrella !== undefined) {
    alertas.push({
      key: "producto-arriba",
      texto: `📈 ${t("dashboard.alerts.productUp", { name: estrella.name, pct: estrella.deltaPct })}`,
      destino: { to: "/reports/sales" },
      tono: "verde",
    });
  }

  const dominante = pagos?.methods[0];
  if (dominante !== undefined && dominante.pct >= 60) {
    alertas.push({
      key: "metodo-dominante",
      texto: `💳 ${t("dashboard.alerts.dominantMethod", {
        pct: dominante.pct,
        method: t(`dashboard.payments.${dominante.method}`).toLowerCase(),
      })}`,
      destino: { to: "/reports/sales" },
      tono: "verde",
    });
  }

  if (alertas.length === 0) {
    return null;
  }

  const ocultas = alertas.length - A_LA_VISTA;
  const visibles = desplegado || ocultas <= 0 ? alertas : alertas.slice(0, A_LA_VISTA);

  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1" aria-label={t("dashboard.alerts.title")}>
        {visibles.map((alerta) => {
          const clase = `block rounded-md border bg-card px-3 py-2 text-sm ${TONO[alerta.tono]}`;
          return (
            <li key={alerta.key}>
              {alerta.destino === null ? (
                <p className={clase}>{alerta.texto}</p>
              ) : (
                <EnlaceAviso
                  destino={alerta.destino}
                  className={`${clase} transition-colors hover:bg-muted`}
                >
                  {alerta.texto}
                </EnlaceAviso>
              )}
            </li>
          );
        })}
      </ul>
      {!desplegado && ocultas > 0 && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="self-start px-0"
          onClick={() => setDesplegado(true)}
        >
          {t("dashboard.alerts.showMore", { count: ocultas })}
        </Button>
      )}
    </div>
  );
}

/** Un `Link` por forma de destino: el router tipa la búsqueda de cada ruta. */
function EnlaceAviso({
  destino,
  className,
  children,
}: {
  destino: Destino;
  className: string;
  children: string;
}) {
  if (destino.to === "/reports/shifts" || destino.to === "/expenses") {
    return (
      <Link to={destino.to} search={destino.search} className={className}>
        {children}
      </Link>
    );
  }
  if (destino.to === "/dashboard") {
    return (
      <Link to={destino.to} hash={destino.hash} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <Link to={destino.to} className={className}>
      {children}
    </Link>
  );
}

export { AlertsBlock };
