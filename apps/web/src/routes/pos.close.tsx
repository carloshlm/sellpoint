import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { CloseSession } from "@/components/pos/close-session";
import { OpenSession } from "@/components/pos/open-session";
import { Button } from "@/components/ui/button";
import { SuccessNotice } from "@/components/ui/success-notice";
import { type CashboxSession, downloadSessionPdf } from "@/lib/pos/api";
import { useSession } from "@/lib/pos/hooks";

/**
 * El cierre de caja. Sin turno abierto no hay nada que cuadrar.
 *
 * Al cerrar (Carlos, 2026-11-16) se baja el PDF carta del cierre —«sólo para
 * control interno», no va a la impresora— y la pantalla, que vuelve a «Abrir
 * turno», dice el folio del que se cerró con un botón para bajarlo otra vez.
 * El aviso vive AQUÍ porque la pantalla del arqueo se desmonta al cerrar.
 */
function CloseContent() {
  const { t } = useTranslation();
  const { data, isPending } = useSession();
  const [cerrado, setCerrado] = useState<CashboxSession | null>(null);
  const [errorPdf, setErrorPdf] = useState(false);

  const bajarPdf = (turno: CashboxSession) => {
    setErrorPdf(false);
    downloadSessionPdf(turno.id, turno.folio).catch(() => setErrorPdf(true));
  };

  if (isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }

  const session = data?.session ?? null;
  if (session !== null) {
    return (
      <CloseSession
        session={session}
        onClosed={(turno) => {
          setCerrado(turno);
          bajarPdf(turno);
        }}
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {cerrado !== null && (
        <SuccessNotice testId="shift-closed">
          <span>{t("pos.session.closedNotice", { folio: cerrado.folio })}</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-fit"
            onClick={() => bajarPdf(cerrado)}
          >
            {t("pos.session.downloadPdf")}
          </Button>
          {errorPdf && (
            <span role="alert" className="text-destructive">
              {t("pos.session.pdfFailed")}
            </span>
          )}
        </SuccessNotice>
      )}
      <OpenSession />
    </div>
  );
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
