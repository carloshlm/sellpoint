import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { StudiesScreen } from "@/components/medical-clinic/studies-screen";

export const Route = createFileRoute("/medical-clinic/diagnostic-studies")({
  component: Page,
});

/** F9-CLINIC-WEB-05 — «Estudios Diagnósticos», la misma pantalla con otro catálogo. */
function Page() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:read">
            <StudiesScreen kind="diagnostic" />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
