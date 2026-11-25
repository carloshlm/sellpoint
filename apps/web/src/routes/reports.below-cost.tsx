import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { ItemsReport, validateItemsReportSearch } from "@/components/reports/items-report";

/** «Vendidos bajo su costo»: lo que se vendió perdiendo, con el permiso de Ventas. */
function BelowCostRoute() {
  const search = Route.useSearch();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <ItemsReport view="below-cost" initial={search} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F10-RPT-04 — acepta `type`, `warehouseId`, `from` y `to` en la URL: lo
 * inválido se descarta y la pantalla abre como siempre.
 */
export const Route = createFileRoute("/reports/below-cost")({
  component: BelowCostRoute,
  validateSearch: validateItemsReportSearch,
});
