import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { CustomerForm } from "@/components/reception/customer-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import { createPatient } from "@/lib/medical-clinic/api";
import { useCreateRecord } from "@/lib/medical-clinic/hooks";

export const Route = createFileRoute("/medical-clinic/patients/new")({
  component: NewPatientPage,
  // El turno que trajo al paciente, cuando se llega desde uno sin cliente.
  validateSearch: (search: Record<string, unknown>): { turnId?: string } =>
    typeof search.turnId === "string" ? { turnId: search.turnId } : {},
});

/**
 * F9-CLINIC-WEB-08 — «Paciente nuevo» desde el consultorio: el MISMO
 * formulario de Recepción (una tabla, una persona) dado de alta por el
 * endpoint del módulo, y al guardar se abre su historia clínica de una vez.
 */
function NewPatientPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <NewPatientContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function NewPatientContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { turnId } = Route.useSearch();
  const createRecord = useCreateRecord();
  const [error, setError] = useState<string | null>(null);
  const volver = () => navigate({ to: "/medical-clinic/attend" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{t("medicalClinic.patient.newTitle")}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {error}
          </p>
        )}
        <CustomerForm
          submitCreate={createPatient}
          onDone={(customer) => {
            if (customer === undefined) {
              volver();
              return;
            }
            createRecord.mutate(
              // El expediente nace ligado al turno que trajo al paciente: así
              // ese turno queda atendido y el encabezado dice de cuál vino.
              { customerId: customer.id, ...(turnId !== undefined && { turnId }) },
              {
                onSuccess: (record) =>
                  navigate({
                    to: "/medical-clinic/records/$recordId",
                    params: { recordId: record.id },
                  }),
                onError: (apiError: ApiError) => setError(apiError.message),
              },
            );
          }}
          onCancel={volver}
        />
      </CardContent>
    </Card>
  );
}
