import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AlertsBlock } from "@/components/dashboard/alerts-block";
import { InventoryWidgets } from "@/components/dashboard/inventory-widgets";
import { KpiRow } from "@/components/dashboard/kpi-row";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { TopProducts } from "@/components/dashboard/top-products";
import type { DashboardPeriod } from "@/lib/dashboard/api";

/**
 * Las DOS piezas que importan recharts entran PEREZOSAS: la librería pesa, y
 * cargarla ansiosa metería sus cientos de módulos en la cadena de imports del
 * routeTree — cada pantalla (y cada test de rutas) la pagaría sin usarla.
 * Con lazy, solo el dashboard la trae, y después del primer pintado.
 */
const SalesCharts = lazy(() =>
  import("@/components/dashboard/sales-charts").then((m) => ({ default: m.SalesCharts })),
);
const PaymentDonut = lazy(() =>
  import("@/components/dashboard/payment-donut").then((m) => ({ default: m.PaymentDonut })),
);

import { ExpiringCard } from "@/components/inventory/expiring-card";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

/** Ruta protegida + shell autenticado (F1-WEB-AUTH-09). */
function DashboardPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <DashboardContent />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  // El período del filtro global: gobierna tops y métodos de pago. Estado de
  // pantalla, no de URL — es una lente de lectura, no una navegación.
  const [period, setPeriod] = useState<DashboardPeriod>("month");

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold" data-testid="dashboard-title">
        {t("common.dashboard.title")}
      </h1>
      {user && (
        <p className="text-muted-foreground">
          {t("common.dashboard.welcome", { name: user.firstName })}
        </p>
      )}
      <KpiRow />
      <AlertsBlock />
      <Suspense fallback={null}>
        <SalesCharts />
      </Suspense>
      <PeriodFilter value={period} onChange={setPeriod} />
      <TopProducts period={period} />
      <div className="grid gap-3 lg:grid-cols-2">
        <InventoryWidgets />
        <Suspense fallback={null}>
          <PaymentDonut period={period} />
        </Suspense>
      </div>
      <ExpiringCard />
    </div>
  );
}
