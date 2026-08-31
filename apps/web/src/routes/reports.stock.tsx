import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { StockReport } from "@/components/reports/stock-report";

/**
 * F5-STK-04 — el stock por almacén, valorizado.
 *
 * `belowMin` entra por URL (F5-DASH-13): los contadores del dashboard
 * navegan acá YA filtrado — llegar a la pantalla y tener que re-aplicar el
 * filtro a mano sería un enlace que promete y no cumple.
 */
function StockReportRoute() {
  const { belowMin } = Route.useSearch();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <StockReport initialBelowMin={belowMin === true} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/reports/stock")({
  component: StockReportRoute,
  validateSearch: z.object({ belowMin: z.boolean().optional() }),
});
