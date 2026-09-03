import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { CustomerForm } from "@/components/reception/customer-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/reception/customers/new")({
  component: NewCustomerPage,
});

/**
 * F9-RECEP-12 — alta de cliente en pantalla completa; Guardar vuelve al listado.
 * En tarjeta, como el formulario de Servicios (Carlos, 2026-09-02): el fondo
 * gris es del listado, capturar datos se hace sobre blanco.
 */
function NewCustomerPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reception:manage">
            <NewCustomerContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function NewCustomerContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const volver = () => navigate({ to: "/reception/customers" });
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("reception.form.createTitle")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CustomerForm onDone={volver} onCancel={volver} />
      </CardContent>
    </Card>
  );
}
