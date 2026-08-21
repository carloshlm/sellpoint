import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { OpenSession } from "@/components/pos/open-session";
import { SessionBar } from "@/components/pos/session-bar";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/pos/hooks";

/**
 * F4-CASHBOX-03 — la puerta del POS.
 *
 * Sin turno abierto **ofrece abrirlo** en vez de mostrar un carrito que no
 * podría cobrar: un botón COBRAR que siempre falla es peor que no tenerlo.
 * El carrito en sí llega en F4-UI-01.
 */
function PosContent() {
  const { t } = useTranslation();
  const { data, isPending } = useSession();

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  const session = data?.session ?? null;
  if (session === null) {
    return <OpenSession />;
  }

  return (
    <div className="flex flex-col gap-4">
      <SessionBar session={session} />
      <p className="text-muted-foreground text-sm">{t("pos.cartComingSoon")}</p>
      <div>
        <Button variant="outline" asChild>
          <Link to="/pos/close">{t("pos.session.close")}</Link>
        </Button>
      </div>
    </div>
  );
}

function PosRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="pos:sell">
            <PosContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/pos/")({ component: PosRoute });
