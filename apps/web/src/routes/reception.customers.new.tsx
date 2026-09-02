import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { CustomerForm } from "@/components/reception/customer-form";

export const Route = createFileRoute("/reception/customers/new")({
  component: NewCustomerPage,
});

/** F9-RECEP-12 — alta de cliente en pantalla completa; Guardar vuelve al listado. */
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
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-xl">{t("reception.form.createTitle")}</h1>
      <CustomerForm onDone={volver} onCancel={volver} />
    </div>
  );
}
