import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { ShiftsReport } from "@/components/reports/shifts-report";

/**
 * F5-SHIFT-04 — los cierres de turno: cada turno con su arqueo. Misma llave
 * que las ventas (`reports:read`): es análisis, no mostrador.
 */
export const Route = createFileRoute("/reports/shifts")({
  component: ShiftsReportRoute,
});

function ShiftsReportRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <ShiftsReport />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
