import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSupplier } from "@/lib/suppliers/hooks";

export const Route = createFileRoute("/suppliers/$supplierId")({
  component: EditSupplierPage,
});

/** F9-SUPPL-08 — edición de proveedor; el PATCH manda solo lo que cambió. */
function EditSupplierPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="suppliers:manage">
            <EditSupplierContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function EditSupplierContent() {
  const { t } = useTranslation();
  const { supplierId } = Route.useParams();
  const navigate = useNavigate();
  const volver = () => navigate({ to: "/suppliers" });
  const { data, isPending, isError } = useSupplier(supplierId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("suppliers.form.editTitle")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("common.form.loading")}
          </p>
        ) : isError || !data ? (
          <p role="alert" className="text-destructive text-sm">
            {t("suppliers.form.loadFailed")}
          </p>
        ) : (
          // `key` por proveedor: cambiar de ficha monta un formulario nuevo.
          <SupplierForm key={data.id} supplier={data} onDone={volver} onCancel={volver} />
        )}
      </CardContent>
    </Card>
  );
}
