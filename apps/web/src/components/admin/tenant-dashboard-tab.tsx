import { lazy, Suspense, useState } from "react";
import { ControlCard } from "@/components/dashboard/control-card";
import { InventoryWidgets } from "@/components/dashboard/inventory-widgets";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { TopProducts } from "@/components/dashboard/top-products";
import type { DashboardPeriod } from "@/lib/dashboard/api";

const SalesCharts = lazy(() =>
  import("@/components/dashboard/sales-charts").then((m) => ({ default: m.SalesCharts })),
);
const PaymentDonut = lazy(() =>
  import("@/components/dashboard/payment-donut").then((m) => ({ default: m.PaymentDonut })),
);

/**
 * F9-ADMIN-10 — el MISMO dashboard del cliente, apuntado al negocio del
 * expediente por el `AdminTenantScopeProvider` que lo envuelve (la ruta).
 * Sin el bloque de alertas ni la tarjeta de vencimientos: sus enlaces llevan
 * a pantallas del negocio propio, que acá serían las del admin. «Control»
 * (F10-KPI-15) sí va: aquí se lee sin enlazar.
 */
export function TenantDashboardTab() {
  const [period, setPeriod] = useState<DashboardPeriod>("month");
  return (
    <div className="flex flex-col gap-3" data-testid="tenant-dashboard">
      <KpiRow />
      <Suspense fallback={null}>
        <SalesCharts />
      </Suspense>
      <PeriodFilter value={period} onChange={setPeriod} />
      <ControlCard period={period} />
      <TopProducts period={period} />
      <div className="grid gap-3 lg:grid-cols-2">
        <InventoryWidgets />
        <Suspense fallback={null}>
          <PaymentDonut period={period} />
        </Suspense>
      </div>
    </div>
  );
}
