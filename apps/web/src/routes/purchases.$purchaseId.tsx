import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { PurchaseDetail } from "@/components/purchases/purchase-detail";
import { usePurchase } from "@/lib/purchases/hooks";

export const Route = createFileRoute("/purchases/$purchaseId")({
  component: PurchasePage,
});

/** F9-PURCH-11 — la compra: cabecera con autoguardado, líneas en bloque y sus acciones. */
function PurchasePage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="purchases:read">
            <PurchaseContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function PurchaseContent() {
  const { t } = useTranslation();
  const { purchaseId } = Route.useParams();
  const { data, isPending, isError } = usePurchase(purchaseId);

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
        {t("purchases.detail.loadFailed")}
      </p>
    );
  }
  // `key` por compra: cambiar de factura monta la pantalla nueva, sin
  // arrastrar lo que el usuario estaba tecleando en la anterior.
  return <PurchaseDetail key={data.id} purchase={data} />;
}
