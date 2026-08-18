import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DocumentDetail } from "@/components/inventory/document-detail";
import { AppLayout } from "@/components/layout/app-layout";

/**
 * F3-DOC-09 — la pantalla del documento, con sus dos caras.
 *
 * El gate es `inventory:read`: quien AUDITA entra y puede imprimir. Lo que
 * exige `inventory:movement` es editar y confirmar, y eso lo decide el
 * componente por dentro.
 */
function DocumentRoute() {
  const { documentId } = Route.useParams();

  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="inventory:read">
            <DocumentDetail documentId={documentId} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/movements/documents/$documentId")({
  component: DocumentRoute,
});
