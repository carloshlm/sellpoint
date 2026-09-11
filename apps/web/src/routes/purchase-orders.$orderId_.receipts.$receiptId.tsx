import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { PurchaseReceiptDetail } from "@/components/purchase-orders/purchase-receipt-detail";
import { usePurchaseReceipt } from "@/lib/purchase-orders/hooks";

export const Route = createFileRoute("/purchase-orders/$orderId_/receipts/$receiptId")({
  component: PurchaseReceiptPage,
});

/** F9-PO-13 — la recepción: lo que llegó de la orden, con su lote. */
function PurchaseReceiptPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="purchases:read">
            <PurchaseReceiptContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function PurchaseReceiptContent() {
  const { t } = useTranslation();
  const { orderId, receiptId } = Route.useParams();
  const { data, isPending, isError } = usePurchaseReceipt(orderId, receiptId);

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
        {t("purchaseOrders.receipt.loadFailed")}
      </p>
    );
  }
  return <PurchaseReceiptDetail key={data.id} receipt={data} />;
}
