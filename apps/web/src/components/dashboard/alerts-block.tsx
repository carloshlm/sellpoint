import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/lib/auth/permissions";
import {
  useDashboardInventory,
  useDashboardKpis,
  useDashboardPayments,
  useDashboardProducts,
} from "@/lib/dashboard/hooks";

/**
 * F5-DASH-15 — las alertas inteligentes: hasta cuatro frases ACCIONABLES
 * compuestas con datos que el panel ya cargó. Cero requests extra por
 * construcción: estos hooks comparten caché con los widgets de al lado
 * (mismas query keys — react-query deduplica), así que el bloque lee, no
 * pide. Cada regla calla cuando su dato no da la nota; sin ninguna, el
 * bloque entero desaparece — un título huérfano sería ruido.
 */
function AlertsBlock() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const puedeVerDinero = has("reports:read");
  const puedeVerStock = has("inventory:read");

  const { data: kpis } = useDashboardKpis(puedeVerDinero);
  const { data: productos } = useDashboardProducts("month", puedeVerDinero);
  const { data: inventario } = useDashboardInventory(puedeVerStock);
  const { data: pagos } = useDashboardPayments("month", puedeVerDinero);

  const alertas: { key: string; texto: string; to: string; tono: "rojo" | "ambar" | "verde" }[] =
    [];

  if (inventario !== undefined && inventario.outOfStock > 0) {
    alertas.push({
      key: "agotados",
      texto: `🔴 ${t("dashboard.alerts.outOfStock", { count: inventario.outOfStock })}`,
      to: "/reports/stock",
      tono: "rojo",
    });
  }

  const deltaHoy = kpis?.today.deltaVsLastWeekPct ?? null;
  if (deltaHoy !== null && deltaHoy <= -10) {
    alertas.push({
      key: "ventas-abajo",
      texto: `⚠️ ${t("dashboard.alerts.salesDown", { pct: Math.abs(deltaHoy) })}`,
      to: "/reports/sales",
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
      to: "/reports/sales",
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
      to: "/reports/sales",
      tono: "verde",
    });
  }

  if (alertas.length === 0) {
    return null;
  }

  const TONO = {
    rojo: "border-destructive/40",
    ambar: "border-warning/40",
    verde: "border-success/40",
  } as const;

  return (
    <ul className="flex flex-col gap-1">
      {alertas.map((alerta) => (
        <li key={alerta.key}>
          <Link
            to={alerta.to}
            className={`block rounded-md border bg-card px-3 py-2 text-sm transition-colors hover:bg-muted ${TONO[alerta.tono]}`}
          >
            {alerta.texto}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export { AlertsBlock };
