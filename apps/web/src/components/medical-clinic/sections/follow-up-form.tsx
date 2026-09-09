import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * F9-CLINIC-HC-21 — Seguimiento y Recomendaciones: la próxima cita (no
 * anterior a la fecha de consulta: `min` del input y refine en shared),
 * los datos de alarma y las recomendaciones.
 */
export function FollowUpForm({
  initialData,
  consultationDate,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.followUp.${sufijo}`);
  const [nextAppointmentDate, setNextAppointmentDate] = useState(
    texto(initialData.nextAppointmentDate),
  );
  const [nextAppointmentNotes, setNextAppointmentNotes] = useState(
    texto(initialData.nextAppointmentNotes),
  );
  const [alarmSigns, setAlarmSigns] = useState(texto(initialData.alarmSigns));
  const [recommendations, setRecommendations] = useState(texto(initialData.recommendations));
  const errorFecha =
    nextAppointmentDate !== "" && nextAppointmentDate < consultationDate
      ? k("appointmentBeforeConsultation")
      : undefined;

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (errorFecha !== undefined) return;
    const data: Record<string, unknown> = {};
    if (nextAppointmentDate) data.nextAppointmentDate = nextAppointmentDate;
    if (nextAppointmentNotes.trim()) data.nextAppointmentNotes = nextAppointmentNotes.trim();
    if (alarmSigns.trim()) data.alarmSigns = alarmSigns.trim();
    if (recommendations.trim()) data.recommendations = recommendations.trim();
    onSubmit(data);
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={k("nextAppointmentDate")}
          type="date"
          min={consultationDate}
          value={nextAppointmentDate}
          onChange={(e) => setNextAppointmentDate(e.target.value)}
          error={errorFecha}
        />
        <TextField
          label={k("nextAppointmentNotes")}
          value={nextAppointmentNotes}
          onChange={(e) => setNextAppointmentNotes(e.target.value)}
          maxLength={300}
        />
        <TextAreaField
          className="sm:col-span-2"
          label={k("alarmSigns")}
          placeholder={k("alarmSignsPlaceholder")}
          rows={3}
          value={alarmSigns}
          onChange={(e) => setAlarmSigns(e.target.value)}
          maxLength={1000}
        />
        <TextAreaField
          className="sm:col-span-2"
          label={k("recommendations")}
          rows={4}
          value={recommendations}
          onChange={(e) => setRecommendations(e.target.value)}
          maxLength={2000}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
