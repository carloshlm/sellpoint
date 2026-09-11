import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { PurchaseOrderDetail } from "@/components/purchase-orders/purchase-order-detail";
import { usePurchaseOrder } from "@/lib/purchase-orders/hooks";

export const Route = createFileRoute("/purchase-orders/$orderId")({
  component: PurchaseOrderPage,
});

/** F9-PO-12 — la orden: cabecera con autoguardado, líneas, recepciones y compras. */
function PurchaseOrderPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="purchases:read">
            <PurchaseOrderContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function PurchaseOrderContent() {
  const { t } = useTranslation();
  const { orderId } = Route.useParams();
  const { data, isPending, isError } = usePurchaseOrder(orderId);

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("common.form.loading")}
      </p>
    );
  }
  if (isError || !data) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {t("purchaseOrders.detail.loadFailed")}
      </p>
    );
  }
  return <PurchaseOrderDetail key={data.id} order={data} />;
}
