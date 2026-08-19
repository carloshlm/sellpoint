import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { TransfersList } from "@/components/inventory/transfers-list";
import { AppLayout } from "@/components/layout/app-layout";

/**
 * F3-TRANSFER-05 — traspasos en tránsito.
 *
 * El gate es `inventory:read`: ver qué está en viaje es leer. Recibir exige
 * `inventory:movement` y cancelar `inventory:manage`, y eso lo decide el
 * componente por dentro.
 */
function TransfersRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="inventory:read">
            <TransfersList />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/movements/transfers")({ component: TransfersRoute });
