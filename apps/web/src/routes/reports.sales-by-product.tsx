import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SalesLinesReport } from "@/components/reports/sales-lines-report";

/** «Ventas por producto»: una línea de ticket por renglón, con el permiso de Ventas. */
function SalesByProductRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <SalesLinesReport kind="product" />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/reports/sales-by-product")({
  component: SalesByProductRoute,
});
