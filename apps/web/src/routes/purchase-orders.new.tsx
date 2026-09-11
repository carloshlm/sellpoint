import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DateField } from "@/components/form/date-field";
import { AppLayout } from "@/components/layout/app-layout";
import { SupplierPicker } from "@/components/suppliers/supplier-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorNotice } from "@/components/ui/error-notice";
import { businessToday } from "@/lib/inventory/format-date";
import { useCreatePurchaseOrder } from "@/lib/purchase-orders/hooks";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/purchase-orders/new")({
  component: NewPurchaseOrderPage,
});

/**
 * F9-PO-11 — la orden nace con lo MÍNIMO: proveedor, fecha del pedido y, si se
 * sabe, la fecha esperada. Las líneas se capturan en el detalle.
 */
function NewPurchaseOrderPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="purchases:manage">
            <NewPurchaseOrderContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function NewPurchaseOrderContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hoy = businessToday(useAuthStore((s) => s.user?.tenant.timezone));
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [orderDate, setOrderDate] = useState(hoy);
  const [expectedDate, setExpectedDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const crear = useCreatePurchaseOrder();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("purchaseOrders.new.title")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (supplierId === null) {
              setError(t("purchaseOrders.new.supplierRequired"));
              return;
            }
            crear.mutate(
              { supplierId, orderDate, expectedDate: expectedDate === "" ? null : expectedDate },
              {
                onSuccess: (orden) =>
                  navigate({ to: "/purchase-orders/$orderId", params: { orderId: orden.id } }),
                onError: (apiError) => setError(apiError.message),
              },
            );
          }}
        >
          {error !== null && <ErrorNotice>{error}</ErrorNotice>}
          <p className="text-muted-foreground text-sm">{t("purchaseOrders.new.intro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SupplierPicker
              value={supplierId}
              onChange={(s) => setSupplierId(s?.id ?? null)}
              label={t("purchaseOrders.new.supplier")}
            />
            <DateField
              label={t("purchaseOrders.new.date")}
              max={hoy}
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
              required
            />
            {/* La ÚNICA fecha sin tope: es la promesa del proveedor. */}
            <DateField
              label={t("purchaseOrders.new.expectedDate")}
              hint={t("purchaseOrders.detail.expectedHint")}
              value={expectedDate}
              onChange={(event) => setExpectedDate(event.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={crear.isPending}>
              {crear.isPending ? t("common.form.submitting") : t("purchaseOrders.new.create")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate({ to: "/purchase-orders" })}
              disabled={crear.isPending}
            >
              {t("common.form.cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
