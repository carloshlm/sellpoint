import { PROGNOSES } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** F9-CLINIC-HC-20 — Plan de Manejo y Pronóstico (NOM-004 6.1.5: el pronóstico es obligatorio en la norma). */
export function ManagementPlanForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.managementPlan.${sufijo}`);
  const [prognosis, setPrognosis] = useState(texto(initialData.prognosis));
  const [prognosisNotes, setPrognosisNotes] = useState(texto(initialData.prognosisNotes));
  const [plan, setPlan] = useState(texto(initialData.plan));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const data: Record<string, unknown> = {};
    if (prognosis) data.prognosis = prognosis;
    if (prognosisNotes.trim()) data.prognosisNotes = prognosisNotes.trim();
    if (plan.trim()) data.plan = plan.trim();
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
        <SelectField
          label={k("prognosis")}
          hint={k("prognosisHint")}
          options={[
            { value: "", label: t("medicalClinic.forms.chooseOption") },
            ...PROGNOSES.map((p) => ({ value: p, label: k(`prognosisOptions.${p}`) })),
          ]}
          value={prognosis}
          onChange={(e) => setPrognosis(e.target.value)}
        />
        <TextField
          label={k("prognosisNotes")}
          value={prognosisNotes}
          onChange={(e) => setPrognosisNotes(e.target.value)}
          maxLength={500}
        />
        <TextAreaField
          className="sm:col-span-2"
          label={k("plan")}
          placeholder={k("planPlaceholder")}
          rows={8}
          value={plan}
          onChange={(e) => setPlan(e.target.value)}
          maxLength={4000}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
