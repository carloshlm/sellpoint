import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { RecordsTable } from "@/components/medical-clinic/records-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paginator } from "@/components/ui/paginator";
import type { ApiError } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-message";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import type { PatientSummary } from "@/lib/medical-clinic/api";
import { useCreateRecord, usePatient, useRecords } from "@/lib/medical-clinic/hooks";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/medical-clinic/patients/$customerId/")({
  component: PatientPage,
});

function PatientPage() {
  const { customerId } = Route.useParams();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <PatientContent customerId={customerId} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F9-CLINIC-WEB-29 — «Resumen del paciente».
 *
 * Lo que se sabe de la persona (Recepción) más los Datos Generales de su
 * última visita (el consultorio), y todas sus historias clínicas para leerlas
 * o continuar la de hoy. Iniciar una consulta desde aquí es lo mismo que
 * desde «Atender paciente»: el mismo alta, la misma carrera de dos médicos.
 */
function PatientContent({ customerId }: { customerId: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canStart = has("medical_clinic:attend") && canWrite;
  const timeZone = useAuthStore((state) => state.user?.tenant?.timezone);
  const locale = i18n.language === "en" ? "en-US" : "es-MX";
  const paciente = usePatient(customerId);
  const [pagina, setPagina] = useState(1);
  const historias = useRecords({ customerId, page: pagina });
  const createRecord = useCreateRecord();
  const [error, setError] = useState<string | null>(null);

  const abrir = (recordId: string) =>
    navigate({ to: "/medical-clinic/records/$recordId", params: { recordId } });

  const iniciar = () => {
    setError(null);
    createRecord.mutate(
      { customerId },
      {
        onSuccess: (record) => abrir(record.id),
        onError: (apiError: ApiError) => {
          if (apiError.code === "medical_clinic.record_open_today" && apiError.recordId) {
            void abrir(apiError.recordId);
            return;
          }
          setError(apiError.message);
        },
      },
    );
  };

  if (paciente.error) {
    return (
      <p role="alert" className="text-destructive text-sm">
        {apiErrorMessage(t, paciente.error, "medicalClinic.patient.summary.loadFailed")}
      </p>
    );
  }
  if (paciente.data === undefined) {
    return <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>;
  }
  const p = paciente.data;
  const abierta = p.lastRecord !== null && p.lastRecord.lockReason === null ? p.lastRecord : null;

  return (
    <div className="flex flex-col gap-4">
      <Link to="/medical-clinic/attend" className="text-primary text-sm hover:underline">
        {t("medicalClinic.patient.summary.back")}
      </Link>

      <Card data-testid="patient-summary">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <CardTitle>
            <h1 className="font-semibold text-xl">{p.name}</h1>
          </CardTitle>
          {abierta !== null ? (
            <Button asChild>
              <Link to="/medical-clinic/records/$recordId" params={{ recordId: abierta.id }}>
                {t("medicalClinic.patient.summary.continue", { folio: abierta.folio })}
              </Link>
            </Button>
          ) : (
            canStart && (
              <Button type="button" disabled={createRecord.isPending} onClick={iniciar}>
                {t("medicalClinic.patient.summary.start")}
              </Button>
            )
          )}
        </CardHeader>
        <CardContent>
          {error && (
            <p role="alert" className="mb-3 text-destructive text-sm">
              {error}
            </p>
          )}
          <Ficha paciente={p} locale={locale} timeZone={timeZone} />
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3" aria-labelledby="patient-records-title">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="patient-records-title" className="font-semibold text-lg">
            {t("medicalClinic.patient.summary.records")}
          </h2>
          <span className="text-muted-foreground text-sm">
            {t("medicalClinic.patient.summary.recordsCount", { count: p.recordCount })}
          </span>
        </div>
        {historias.error ? (
          <p role="alert" className="text-destructive text-sm">
            {apiErrorMessage(t, historias.error, "medicalClinic.history.loadFailed")}
          </p>
        ) : historias.data === undefined ? (
          <p className="text-muted-foreground text-sm">{t("common.form.loading")}</p>
        ) : historias.data.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("medicalClinic.patient.summary.noRecords")}
          </p>
        ) : (
          <>
            <RecordsTable rows={historias.data.rows} showPatient={false} />
            <Paginator
              page={historias.data.page}
              pageSize={historias.data.pageSize}
              total={historias.data.total}
              onPageChange={setPagina}
            />
          </>
        )}
      </section>
    </div>
  );
}

/** Los datos de la persona, en dos columnas; lo que falta se dice con «—». */
function Ficha({
  paciente,
  locale,
  timeZone,
}: {
  paciente: PatientSummary;
  locale: string;
  timeZone: string | undefined;
}) {
  const { t } = useTranslation();
  const g = paciente.generalData ?? {};
  const texto = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  const sexo = texto(g.sex);
  const contacto = [texto(g.emergencyContactName), texto(g.emergencyContactPhone)]
    .filter(Boolean)
    .join(" · ");
  const nada = t("medicalClinic.patient.summary.none");
  const datos: [string, string | null][] = [
    [
      t("medicalClinic.patient.summary.age"),
      paciente.age === null ? null : t("medicalClinic.attend.years", { count: paciente.age }),
    ],
    [
      t("medicalClinic.patient.summary.birthDate"),
      paciente.birthDate === null
        ? null
        : formatBusinessDate(`${paciente.birthDate}T12:00:00Z`, locale, timeZone),
    ],
    [
      t("medicalClinic.patient.summary.sex"),
      sexo === null ? null : t(`medicalClinic.record.sexValues.${sexo}`),
    ],
    [t("medicalClinic.patient.summary.phone"), paciente.phone],
    [t("medicalClinic.patient.summary.email"), paciente.email],
    [t("medicalClinic.patient.summary.occupation"), texto(g.occupation)],
    [t("medicalClinic.patient.summary.emergencyContact"), contacto || null],
    [t("medicalClinic.patient.summary.notes"), paciente.notes],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {datos.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="flex flex-col">
          <dt className="text-muted-foreground text-xs">{etiqueta}</dt>
          <dd>{valor ?? nada}</dd>
        </div>
      ))}
    </dl>
  );
}
