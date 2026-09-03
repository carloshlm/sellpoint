import { ONSET_UNITS } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

/** F9-CLINIC-WEB-15 — Motivo de Consulta: el motivo en palabras del paciente y el tiempo de evolución. */
export function ChiefComplaintForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const [complaint, setComplaint] = useState(texto(initialData.complaint));
  const [onsetValue, setOnsetValue] = useState(texto(initialData.onsetValue));
  const [onsetUnit, setOnsetUnit] = useState(texto(initialData.onsetUnit));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const data: Record<string, unknown> = {};
    if (complaint.trim() !== "") data.complaint = complaint.trim();
    if (onsetValue.trim() !== "") data.onsetValue = Number(onsetValue);
    if (onsetUnit !== "") data.onsetUnit = onsetUnit;
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
        <TextAreaField
          className="sm:col-span-2"
          label={t("medicalClinic.forms.chiefComplaint.complaint")}
          placeholder={t("medicalClinic.forms.chiefComplaint.complaintPlaceholder")}
          rows={4}
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          maxLength={2000}
        />
        <TextField
          label={t("medicalClinic.forms.chiefComplaint.onsetValue")}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={onsetValue}
          onChange={(e) => setOnsetValue(e.target.value.replace(/\D/g, ""))}
        />
        <SelectField
          label={t("medicalClinic.forms.chiefComplaint.onsetUnit")}
          options={[
            { value: "", label: t("medicalClinic.forms.chooseOption") },
            ...ONSET_UNITS.map((u) => ({
              value: u,
              label: t(`medicalClinic.forms.chiefComplaint.onsetUnitOptions.${u}`),
            })),
          ]}
          value={onsetUnit}
          onChange={(e) => setOnsetUnit(e.target.value)}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
