import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ExpiringList } from "@/components/inventory/expiring-list";
import { AppLayout } from "@/components/layout/app-layout";

/**
 * F3-LOTS-03 — próximos a vencer.
 *
 * El gate es `inventory:read`: ver qué se está por echar a perder es leer. Lo
 * que exige `inventory:movement` es dar la salida, y eso lo decide el
 * componente por dentro.
 */
function ExpiringRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="inventory:read">
            <ExpiringList />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/movements/expiring")({ component: ExpiringRoute });
