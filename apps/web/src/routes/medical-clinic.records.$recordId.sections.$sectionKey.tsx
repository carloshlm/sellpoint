import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { SECTION_FORMS } from "@/components/medical-clinic/sections/registry";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRecord, useSaveSection } from "@/lib/medical-clinic/hooks";

export const Route = createFileRoute("/medical-clinic/records/$recordId/sections/$sectionKey")({
  component: SectionPage,
});

function SectionPage() {
  const { recordId, sectionKey } = Route.useParams();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <SectionScreen recordId={recordId} sectionKey={sectionKey} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F9-CLINIC-WEB-13 — la ruta genérica de sección: el formulario sale del
 * registro por clave; una clave sin formulario (o inventada) vuelve al
 * tablero sin hacer ruido. Es una RUTA y no un modal a propósito: Atrás es
 * Cancelar y el tablero se refresca solo al volver.
 */
function SectionScreen({ recordId, sectionKey }: { recordId: string; sectionKey: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const record = useRecord(recordId);
  const guardar = useSaveSection(recordId);
  const Form = SECTION_FORMS[sectionKey];

  if (!Form) {
    return <Navigate to="/medical-clinic/records/$recordId" params={{ recordId }} replace />;
  }
  if (record.isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }
  if (record.isError || !record.data) {
    return <p role="alert">{t("medicalClinic.record.loadFailed")}</p>;
  }
  const expediente = record.data;
  const readOnly = expediente.status === "closed";
  const seccion = expediente.sections.find((s) => s.key === sectionKey);
  const volver = () =>
    void navigate({ to: "/medical-clinic/records/$recordId", params: { recordId }, replace: true });

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/medical-clinic/records/$recordId"
        params={{ recordId }}
        className="w-fit text-muted-foreground text-sm underline-offset-2 hover:underline"
      >
        ← {t("medicalClinic.record.back", { folio: expediente.folio })}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1>{t(`medicalClinic.sections.${sectionKey}.title`)}</h1>
          </CardTitle>
          <CardDescription>
            {expediente.patient.name} · <span className="font-mono">{expediente.folio}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {readOnly ? (
            <p className="rounded-md border bg-muted p-3 text-sm">
              {t("medicalClinic.forms.readOnly")}
            </p>
          ) : null}
          <Form
            key={sectionKey}
            recordId={recordId}
            initialData={seccion?.data && typeof seccion.data === "object" ? seccion.data : {}}
            readOnly={readOnly}
            busy={guardar.isPending}
            error={guardar.isError ? t("medicalClinic.forms.saveFailed") : null}
            onSubmit={(data) => guardar.mutate({ key: sectionKey, data }, { onSuccess: volver })}
            onCancel={volver}
          />
        </CardContent>
      </Card>
    </div>
  );
}
