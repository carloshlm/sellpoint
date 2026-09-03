import { MEDICAL_ORDER_KINDS, type MedicalOrderKind } from "@sellpoint/shared";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { MedicationPicker } from "@/components/medical-clinic/medication-picker";
import { OrderFormShell } from "@/components/medical-clinic/order-form-shell";
import { StudyPicker } from "@/components/medical-clinic/study-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Study } from "@/lib/medical-clinic/api";
import { useMedicalClinicSettings, useRecord } from "@/lib/medical-clinic/hooks";
import { type OrderFormLine, STUDY_KIND_OF } from "@/lib/medical-clinic/order-lines";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/medical-clinic/records/$recordId/orders/$orderKind")({
  component: OrderPage,
});

function OrderPage() {
  const { recordId, orderKind } = Route.useParams();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <OrderScreen recordId={recordId} orderKind={orderKind} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

const esKind = (k: string): k is MedicalOrderKind =>
  (MEDICAL_ORDER_KINDS as readonly string[]).includes(k);

/**
 * F9-CLINIC-WEB-17/18 — la orden: receta desde el stock del médico, o
 * estudios del catálogo. Las líneas viven aquí; el cascarón las pinta y
 * emite.
 */
function OrderScreen({ recordId, orderKind }: { recordId: string; orderKind: string }) {
  const { t } = useTranslation();
  const record = useRecord(recordId);
  const puedeVerConfig = useAuthStore(
    (s) => s.user?.permissions.includes("tenants:manage") ?? false,
  );
  const settings = useMedicalClinicSettings(puedeVerConfig);
  const [lines, setLines] = useState<OrderFormLine[]>([]);

  if (!esKind(orderKind)) {
    return <Navigate to="/medical-clinic/records/$recordId" params={{ recordId }} replace />;
  }
  if (record.isPending) return <p role="status">{t("common.form.loading")}</p>;
  if (record.isError || !record.data)
    return <p role="alert">{t("medicalClinic.record.loadFailed")}</p>;
  const expediente = record.data;
  const studyKind = STUDY_KIND_OF[orderKind];
  const seleccionados = new Set(
    lines.filter((l) => l.kind === "study").map((l) => (l.kind === "study" ? l.studyId : "")),
  );

  const alternarEstudio = (study: Study) => {
    if (!studyKind) return;
    setLines((actuales) =>
      actuales.some((l) => l.kind === "study" && l.studyId === study.id)
        ? actuales.filter((l) => !(l.kind === "study" && l.studyId === study.id))
        : [
            ...actuales,
            {
              key: `study:${study.id}`,
              kind: "study",
              studyKind,
              studyId: study.id,
              description: study.name,
              unitPrice: Number(study.price ?? 0),
            },
          ],
    );
  };

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
            <h1>{t(`medicalClinic.orders.${orderKind}.title`)}</h1>
          </CardTitle>
          <CardDescription>
            {expediente.patient.name} · <span className="font-mono">{expediente.folio}</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expediente.status === "closed" ? (
            <p className="rounded-md border bg-muted p-3 text-sm">
              {t("medicalClinic.record.closed")}
            </p>
          ) : (
            <OrderFormShell
              recordId={recordId}
              kind={orderKind}
              lines={lines}
              onLinesChange={setLines}
            >
              {studyKind ? (
                <StudyPicker
                  kind={studyKind}
                  label={t(`medicalClinic.orders.${orderKind}.pickerLabel`)}
                  placeholder={t(`medicalClinic.orders.${orderKind}.pickerPlaceholder`)}
                  selectedIds={seleccionados}
                  onToggle={alternarEstudio}
                />
              ) : (
                <MedicationPicker
                  label={t("medicalClinic.orders.prescription.pickerLabel")}
                  placeholder={t("medicalClinic.orders.prescription.pickerPlaceholder")}
                  showStock={settings.data?.sellsMedications !== false}
                  onAdd={(item, presentacion) =>
                    setLines((actuales) => {
                      const key = `med:${item.id}:${presentacion.id}`;
                      if (actuales.some((l) => l.key === key)) return actuales;
                      return [
                        ...actuales,
                        {
                          key,
                          kind: "medication",
                          productId: item.id,
                          presentationId: presentacion.id,
                          presentationName: presentacion.name,
                          description: item.name,
                          unitPrice: Number(presentacion.price ?? 0),
                          quantity: "1",
                          dosage: "",
                          allowFractionalInput: presentacion.allowFractionalInput,
                        },
                      ];
                    })
                  }
                />
              )}
            </OrderFormShell>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
