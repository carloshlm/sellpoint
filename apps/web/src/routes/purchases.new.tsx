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
import { useCreatePurchase } from "@/lib/purchases/hooks";

export const Route = createFileRoute("/purchases/new")({
  component: NewPurchasePage,
});

/**
 * F9-PURCH-10 — la compra nace con lo MÍNIMO: proveedor y la fecha del papel.
 * Las líneas se capturan en el detalle, que es donde vive el autoguardado.
 */
function NewPurchasePage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="purchases:manage">
            <NewPurchaseContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function NewPurchaseContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hoy = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [purchaseDate, setPurchaseDate] = useState(hoy);
  const [error, setError] = useState<string | null>(null);
  const crear = useCreatePurchase();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("purchases.new.title")}</h1>
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
              setError(t("purchases.new.supplierRequired"));
              return;
            }
            crear.mutate(
              { supplierId, purchaseDate },
              {
                onSuccess: (compra) =>
                  navigate({ to: "/purchases/$purchaseId", params: { purchaseId: compra.id } }),
                onError: (apiError) => setError(apiError.message),
              },
            );
          }}
        >
          {error !== null && <ErrorNotice>{error}</ErrorNotice>}
          <p className="text-muted-foreground text-sm">{t("purchases.new.intro")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <SupplierPicker
              value={supplierId}
              onChange={(s) => setSupplierId(s?.id ?? null)}
              label={t("purchases.new.supplier")}
            />
            <DateField
              label={t("purchases.new.date")}
              value={purchaseDate}
              onChange={(event) => setPurchaseDate(event.target.value)}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={crear.isPending}>
              {crear.isPending ? t("common.form.submitting") : t("purchases.new.create")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate({ to: "/purchases" })}
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
