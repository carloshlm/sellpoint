import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** F9-CLINIC-HC-18 — Impresión Diagnóstica: el juicio clínico de primer contacto, en texto. */
export function DiagnosticImpressionForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const [impression, setImpression] = useState(texto(initialData.impression));
  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit(impression.trim() ? { impression: impression.trim() } : {});
  };
  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-4">
        <TextAreaField
          label={t("medicalClinic.forms.diagnosticImpression.impression")}
          placeholder={t("medicalClinic.forms.diagnosticImpression.placeholder")}
          rows={5}
          value={impression}
          onChange={(e) => setImpression(e.target.value)}
          maxLength={2000}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
