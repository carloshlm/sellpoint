import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { CustomerForm } from "@/components/reception/customer-form";
import { ReceptionItemGate } from "@/components/reception/reception-item-gate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCustomer } from "@/lib/reception/hooks";
import { useReceptionEntity } from "@/lib/reception/settings";

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
            <ReceptionItemGate item="customers">
              <EditCustomerContent />
            </ReceptionItemGate>
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function EditCustomerContent() {
  const { t } = useTranslation();
  const entidad = useReceptionEntity();
  const { customerId } = Route.useParams();
  const navigate = useNavigate();
  const volver = () => navigate({ to: "/reception/customers" });
  const { data, isPending, isError } = useCustomer(customerId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("reception.form.editTitle", entidad.vars)}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("common.form.loading")}
          </p>
        ) : isError || !data ? (
          <p role="alert" className="text-destructive text-sm">
            {t("reception.form.loadFailed", entidad.vars)}
          </p>
        ) : (
          // `key` por cliente: cambiar de ficha monta un formulario nuevo.
          <CustomerForm key={data.id} customer={data} onDone={volver} onCancel={volver} />
        )}
      </CardContent>
    </Card>
  );
}
