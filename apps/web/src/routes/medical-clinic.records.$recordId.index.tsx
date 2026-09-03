import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";

export const Route = createFileRoute("/medical-clinic/records/$recordId/")({
  component: RecordPage,
});

/** F9-CLINIC-WEB-12 — el tablero de la historia clínica (se arma en el lote siguiente). */
function RecordPage() {
  const { recordId } = Route.useParams();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <p data-testid="record-placeholder">{recordId}</p>
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
