import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { PurchaseOrderList } from "@/components/purchase-orders/purchase-order-list";

export const Route = createFileRoute("/purchase-orders/")({
  component: PurchaseOrdersPage,
});

/** F9-PO-11 — «Órdenes de compra». Sin `purchases:read` la pantalla NO existe. */
function PurchaseOrdersPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="purchases:read">
            <PurchaseOrderList />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}
