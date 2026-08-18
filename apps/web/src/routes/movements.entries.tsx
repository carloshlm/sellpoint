import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DocumentList } from "@/components/inventory/document-list";
import { AppLayout } from "@/components/layout/app-layout";

/**
 * F3-DOC-08 — una de las tres montaduras del MISMO listado. Lo único que
 * cambia es el `type`: para quien la usa es la misma pantalla con otro
 * contenido, y tenerlas separadas las haría divergir.
 */
function MovementsRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="inventory:read">
            <DocumentList type="entry" />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/movements/entries")({ component: MovementsRoute });
