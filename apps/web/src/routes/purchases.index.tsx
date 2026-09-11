import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { PurchaseList } from "@/components/purchases/purchase-list";

export const Route = createFileRoute("/purchases/")({
  component: PurchasesPage,
});

/** F9-PURCH-10 — «Compras». Sin `purchases:read` la pantalla NO existe. */
function PurchasesPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="purchases:read">
            <PurchaseList />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
