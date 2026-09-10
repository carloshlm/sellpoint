import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/suppliers/new")({
  component: NewSupplierPage,
});

/** F9-SUPPL-08 — alta de proveedor en pantalla completa, en tarjeta; Guardar vuelve al listado. */
function NewSupplierPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="suppliers:manage">
            <NewSupplierContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function NewSupplierContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const volver = () => navigate({ to: "/suppliers" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("suppliers.form.createTitle")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SupplierForm onDone={volver} onCancel={volver} />
      </CardContent>
    </Card>
  );
}
