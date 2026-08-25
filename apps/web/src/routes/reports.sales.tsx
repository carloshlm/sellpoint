import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SalesReport } from "@/components/reports/sales-report";

/**
 * F5-SALES-03 — las ventas del período.
 *
 * `reports:read` y no `pos:view`: el historial del POS es el mostrador y esta
 * pantalla es el análisis. Dos audiencias, dos permisos.
 */
function SalesReportRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reports:read">
            <SalesReport />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/reports/sales")({ component: SalesReportRoute });
