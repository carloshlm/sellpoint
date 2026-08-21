import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { CloseSession } from "@/components/pos/close-session";
import { OpenSession } from "@/components/pos/open-session";
import { useSession } from "@/lib/pos/hooks";

/** El cierre de caja. Sin turno abierto no hay nada que cuadrar. */
function CloseContent() {
  const { t } = useTranslation();
  const { data, isPending } = useSession();

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  const session = data?.session ?? null;
  return session === null ? <OpenSession /> : <CloseSession session={session} />;
}

function CloseRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="pos:sell">
            <CloseContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/pos/close")({ component: CloseRoute });
