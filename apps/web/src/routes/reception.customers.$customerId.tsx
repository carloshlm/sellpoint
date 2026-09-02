import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { CustomerForm } from "@/components/reception/customer-form";
import { useCustomer } from "@/lib/reception/hooks";

export const Route = createFileRoute("/reception/customers/$customerId")({
  component: EditCustomerPage,
});

/** F9-RECEP-12 — edición de cliente en pantalla completa; el PATCH manda solo lo que cambió. */
function EditCustomerPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="reception:manage">
            <EditCustomerContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function EditCustomerContent() {
  const { t } = useTranslation();
  const { customerId } = Route.useParams();
  const navigate = useNavigate();
  const volver = () => navigate({ to: "/reception/customers" });
  const { data, isPending, isError } = useCustomer(customerId);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-xl">{t("reception.form.editTitle")}</h1>
      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : isError || !data ? (
        <p role="alert" className="text-destructive text-sm">
          {t("reception.form.loadFailed")}
        </p>
      ) : (
        // `key` por cliente: cambiar de ficha monta un formulario nuevo.
        <CustomerForm key={data.id} customer={data} onDone={volver} onCancel={volver} />
      )}
    </div>
  );
}
