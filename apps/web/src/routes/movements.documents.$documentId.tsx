import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";

/**
 * Placeholder hasta F3-DOC-09 (la pantalla del documento con autoguardado y
 * previa en vivo). La ruta existe desde ahora porque el botón «Crear» de
 * F3-DOC-08 navega acá: crear un borrador y caer en un 404 sería peor que no
 * poder crearlo.
 */
function DocumentRoute() {
  const { t } = useTranslation();
  const { documentId } = Route.useParams();

  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="inventory:read">
            <section className="flex flex-col gap-2">
              <h1 className="font-semibold text-xl">{documentId}</h1>
              <p className="text-muted-foreground text-sm">{t("inventory.placeholder")}</p>
            </section>
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/movements/documents/$documentId")({
  component: DocumentRoute,
});
