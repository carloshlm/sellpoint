import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { AppLayout } from "@/components/layout/app-layout";
import { RecordHeader } from "@/components/medical-clinic/record-header";
import { SectionCard } from "@/components/medical-clinic/section-card";
import { StatusPill } from "@/components/medical-clinic/status-pill";
import { Button } from "@/components/ui/button";
import { useCloseRecord, useCreateRecord, useRecord } from "@/lib/medical-clinic/hooks";
import {
  groupProgress,
  groupStatus,
  RECORD_CARDS,
  RECORD_GROUPS,
  type RecordGroup,
  sectionStatus,
} from "@/lib/medical-clinic/sections";
import { summaryOf } from "@/lib/medical-clinic/summary";

export const Route = createFileRoute("/medical-clinic/records/$recordId/")({
  component: RecordPage,
});

function RecordPage() {
  const { recordId } = Route.useParams();
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="medical_clinic:attend">
            <RecordDashboard recordId={recordId} />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/**
 * F9-CLINIC-WEB-12 — el tablero de la historia clínica: cinco grupos, 36
 * tarjetas en el orden del catálogo, el estado derivado de lo capturado y
 * el cierre de la consulta con confirmación.
 */
function RecordDashboard({ recordId }: { recordId: string }) {
  const { t } = useTranslation();
  const record = useRecord(recordId);
  const cerrar = useCloseRecord(recordId);
  const nueva = useCreateRecord();
  const navigate = useNavigate();
  const [confirmando, setConfirmando] = useState(false);

  if (record.isPending) {
    return <p role="status">{t("common.form.loading")}</p>;
  }
  if (record.isError || !record.data) {
    return <p role="alert">{t("medicalClinic.record.loadFailed")}</p>;
  }
  const expediente = record.data;

  return (
    <div className="flex flex-col gap-6">
      <RecordHeader record={expediente} />
      {expediente.lockReason !== null ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted p-3">
          <p className="text-sm">
            {t(
              `medicalClinic.record.${expediente.lockReason === "expired" ? "expired" : "closed"}`,
            )}
          </p>
          {/* Sin cliente (lo borraron de Recepción) no hay a quién abrirle otra. */}
          {expediente.lockReason === "expired" && expediente.patient.customerId !== null ? (
            <Button
              onClick={() =>
                nueva.mutate(
                  { customerId: expediente.patient.customerId as string },
                  {
                    onSuccess: (creado) =>
                      navigate({
                        to: "/medical-clinic/records/$recordId",
                        params: { recordId: creado.id },
                      }),
                  },
                )
              }
              disabled={nueva.isPending}
            >
              {t("medicalClinic.record.newVisit")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {nueva.isError ? (
        <p role="alert" className="text-destructive text-sm">
          {t("medicalClinic.record.newVisitFailed")}
        </p>
      ) : null}
      <div data-testid="record-groups" className="flex flex-col gap-8">
        {RECORD_GROUPS.map((group) => (
          <RecordGroupSection
            key={group}
            group={group}
            recordId={recordId}
            record={expediente}
            t={t}
          />
        ))}
      </div>
      {expediente.status === "open" ? (
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setConfirmando(true)}>
            {t("medicalClinic.record.close")}
          </Button>
        </div>
      ) : null}
      {confirmando ? (
        <ConfirmDialog
          title={t("medicalClinic.record.closeTitle", { folio: expediente.folio })}
          body={t("medicalClinic.record.closeBody")}
          confirmLabel={t("medicalClinic.record.closeConfirm")}
          cancelLabel={t("common.form.cancel")}
          busy={cerrar.isPending}
          onCancel={() => setConfirmando(false)}
          onConfirm={() => cerrar.mutate(undefined, { onSettled: () => setConfirmando(false) })}
        />
      ) : null}
    </div>
  );
}

function RecordGroupSection({
  group,
  recordId,
  record,
  t,
}: {
  group: RecordGroup;
  recordId: string;
  record: NonNullable<ReturnType<typeof useRecord>["data"]>;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  const headingId = `record-group-${group}-title`;
  const cards = RECORD_CARDS.filter((card) => card.group === group);
  const progreso = groupProgress(record, group);
  const ordenes = record.orders.length;

  return (
    <section
      aria-labelledby={headingId}
      data-testid={`record-group-${group}`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={headingId} className="font-semibold text-lg">
          {t(`medicalClinic.groups.${group}`)}
        </h2>
        {group === "orders" ? (
          <span className="text-muted-foreground text-sm">
            {t("medicalClinic.record.orders", { count: ordenes })}
          </span>
        ) : (
          <>
            <StatusPill status={groupStatus(record, group)} />
            {progreso.total > 0 ? (
              <span className="text-muted-foreground text-sm">
                {t("medicalClinic.record.groupCount", progreso)}
              </span>
            ) : null}
          </>
        )}
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => {
          const seccion = record.sections.find((s) => s.key === card.key);
          const status =
            card.kind === "orders_list"
              ? ordenes > 0
                ? "completed"
                : "pending"
              : sectionStatus(record, card.key);
          const summary =
            card.kind === "orders_list"
              ? t("medicalClinic.record.orders", { count: ordenes })
              : summaryOf(card.key, seccion?.data, t);
          return (
            <li key={card.key}>
              <SectionCard card={card} recordId={recordId} status={status} summary={summary} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
