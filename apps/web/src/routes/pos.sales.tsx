import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SalesHistory } from "@/components/pos/sales-history";

/**
 * F4-UI-03 — el historial.
 *
 * `pos:view` y no `pos:sell`: un auditor lee las ventas sin poder hacer
 * ninguna. La ANULACIÓN, dentro de la pantalla, se gatea aparte con
 * `pos:cancel` — la regla del nav de F2: el grupo se ve con un permiso, cada
 * acción se gatea con el suyo.
 */
function SalesRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="pos:view">
            <SalesHistory />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/pos/sales")({ component: SalesRoute });
