import { localCalendarDate } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { useAuthStore } from "@/stores/auth.store";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * F9-CLINIC-WEB-15 — Padecimiento Actual: la fecha de inicio (nunca futura,
 * en el calendario del negocio) y la narrativa larga.
 */
export function CurrentIllnessForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const timezone = useAuthStore((s) => s.user?.tenant.timezone);
  const hoy = localCalendarDate(timezone ?? "UTC", new Date());
  const [startDate, setStartDate] = useState(texto(initialData.startDate));
  const [narrative, setNarrative] = useState(texto(initialData.narrative));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const data: Record<string, unknown> = {};
    if (startDate !== "") data.startDate = startDate;
    if (narrative.trim() !== "") data.narrative = narrative.trim();
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
          label={t("medicalClinic.forms.currentIllness.startDate")}
          type="date"
          max={hoy}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <TextAreaField
          className="sm:col-span-2"
          label={t("medicalClinic.forms.currentIllness.narrative")}
          placeholder={t("medicalClinic.forms.currentIllness.narrativePlaceholder")}
          rows={10}
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          maxLength={10000}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
