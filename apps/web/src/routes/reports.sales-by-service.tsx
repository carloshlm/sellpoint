import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { validateSalesLinesSearch } from "@/components/reports/sales-filters";
import { SalesLinesReport } from "@/components/reports/sales-lines-report";

/** «Ventas por servicio»: una línea de ticket por renglón, con el permiso de Ventas. */
function SalesByServiceRoute() {
  const search = Route.useSearch();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <SalesLinesReport kind="service" initial={search} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F10-RPT-02 — acepta `itemId`, `warehouseId`, `from` y `to` en la URL, para
 * llegar ya filtrada a las ventas de un servicio (el aviso «creció» del panel).
 */
export const Route = createFileRoute("/reports/sales-by-service")({
  component: SalesByServiceRoute,
  validateSearch: validateSalesLinesSearch,
});
