import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { TaxReport } from "@/components/reports/tax-report";

/**
 * F4-TAX-21 — los impuestos cobrados: lo que el negocio declara. Misma llave
 * que las ventas (`reports:read`): es análisis, no mostrador.
 */
export const Route = createFileRoute("/reports/taxes")({
  component: TaxReportRoute,
});

function TaxReportRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <TaxReport />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
