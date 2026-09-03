import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { StudiesScreen } from "@/components/medical-clinic/studies-screen";

export const Route = createFileRoute("/medical-clinic/lab-studies")({
  component: Page,
});

/** F9-CLINIC-WEB-04 — «Estudios de Laboratorio». */
function Page() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:read">
            <StudiesScreen kind="lab" />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
