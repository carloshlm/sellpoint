import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { PatientResultList } from "@/components/medical-clinic/patient-result-list";
import {
  PatientSearchForm,
  type SearchMode,
} from "@/components/medical-clinic/patient-search-form";
import { Card, CardContent } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import { usePlan } from "@/lib/billing/use-plan";
import type { PatientHit } from "@/lib/medical-clinic/api";
import { useCreateRecord, usePatientSearch } from "@/lib/medical-clinic/hooks";

export const Route = createFileRoute("/medical-clinic/attend")({
  component: AttendPage,
});

const BOTON_PRIMARIO =
  "inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground text-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-ring";

/** F9-CLINIC-WEB-07 — «Atender paciente». Solo con `:attend`. */
function AttendPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <AttendContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function AttendContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const { canWrite } = usePlan();
  const canStart = has("medical_clinic:attend") && canWrite;
  const [busqueda, setBusqueda] = useState<{ mode: SearchMode; q: string } | null>(null);
  const { data, isFetching, isError } = usePatientSearch(
    busqueda ?? { mode: "name", q: "" },
    busqueda !== null,
  );
  const createRecord = useCreateRecord();
  const [error, setError] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState<string | null>(null);

  const iniciar = (hit: PatientHit) => {
    setError(null);
    // Un turno sin cliente: no hay expediente que abrir todavía. Se va al
    // alta llevando el turno, y el paciente nace ligado a él.
    if (hit.customerId === null) {
      void navigate({
        to: "/medical-clinic/patients/new",
        search: hit.turnId === null ? {} : { turnId: hit.turnId },
      });
      return;
    }
    setAbriendo(hit.customerId);
    const abrir = (recordId: string) =>
      navigate({ to: "/medical-clinic/records/$recordId", params: { recordId } });
    createRecord.mutate(
      // El turno viaja al expediente: así el encabezado dice de qué turno vino.
      { customerId: hit.customerId as string, ...(hit.turnId !== null && { turnId: hit.turnId }) },
      {
        onSuccess: (record) => abrir(record.id),
        onError: (apiError: ApiError) => {
          setAbriendo(null);
          // Otro médico ganó la carrera: en vez de un error sin salida, se
          // lleva al usuario a la consulta que ya está abierta.
          if (apiError.code === "medical_clinic.record_open_today" && apiError.recordId) {
            void abrir(apiError.recordId);
            return;
          }
          setError(apiError.message);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-semibold text-xl">{t("medicalClinic.attend.title")}</h1>
        {canStart && (
          <Link to="/medical-clinic/patients/new" className={BOTON_PRIMARIO}>
            {t("medicalClinic.attend.newPatient")}
          </Link>
        )}
      </div>

      <Card>
        <CardContent>
          <PatientSearchForm busy={isFetching} onSearch={setBusqueda} />
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {isError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {t("medicalClinic.attend.searchFailed")}
        </p>
      )}

      {busqueda !== null && data !== undefined && data.length === 0 && (
        <p className="text-muted-foreground text-sm" data-testid="patients-empty">
          {busqueda.mode === "turn"
            ? t("medicalClinic.attend.emptyByTurn", { number: busqueda.q })
            : t("medicalClinic.attend.empty")}{" "}
          {canStart && (
            <Link to="/medical-clinic/patients/new" className="text-primary hover:underline">
              {t("medicalClinic.attend.newPatient")}
            </Link>
          )}
        </p>
      )}
      {data !== undefined && data.length > 0 && (
        <PatientResultList hits={data} canStart={canStart} starting={abriendo} onStart={iniciar} />
      )}
    </div>
  );
}
