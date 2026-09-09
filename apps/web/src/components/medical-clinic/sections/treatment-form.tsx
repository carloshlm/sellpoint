import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * F9-CLINIC-HC-19 — Tratamiento: la indicación terapéutica (NOM-004 6.1.6)
 * en tres textos: farmacológico, no farmacológico y procedimientos. La
 * RECETA con folio y cobro sigue viviendo en Órdenes médicas: aquí se
 * enlistan las emitidas y hay un enlace para emitir una.
 */
export function TreatmentForm({
  recordId,
  initialData,
  orders,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.treatment.${sufijo}`);
  const [pharmacological, setPharmacological] = useState(texto(initialData.pharmacological));
  const [nonPharmacological, setNonPharmacological] = useState(
    texto(initialData.nonPharmacological),
  );
  const [procedures, setProcedures] = useState(texto(initialData.procedures));
  const recetas = orders.filter((o) => o.kind === "prescription" && o.status === "issued");

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const data: Record<string, unknown> = {};
    if (pharmacological.trim()) data.pharmacological = pharmacological.trim();
    if (nonPharmacological.trim()) data.nonPharmacological = nonPharmacological.trim();
    if (procedures.trim()) data.procedures = procedures.trim();
    onSubmit(data);
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/40 p-3 text-sm">
        <span data-testid="issued-prescriptions">
          {recetas.length > 0
            ? `${k("issued")}: ${recetas.map((r) => r.folio).join(", ")}`
            : k("noPrescriptions")}
        </span>
        {readOnly ? null : (
          <Link
            to="/medical-clinic/records/$recordId/orders/$orderKind"
            params={{ recordId, orderKind: "prescription" }}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {k("issuePrescription")}
          </Link>
        )}
      </div>
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-4">
        <TextAreaField
          label={k("pharmacological")}
          placeholder={k("pharmacologicalPlaceholder")}
          rows={5}
          value={pharmacological}
          onChange={(e) => setPharmacological(e.target.value)}
          maxLength={4000}
        />
        <TextAreaField
          label={k("nonPharmacological")}
          placeholder={k("nonPharmacologicalPlaceholder")}
          rows={4}
          value={nonPharmacological}
          onChange={(e) => setNonPharmacological(e.target.value)}
          maxLength={2000}
        />
        <TextAreaField
          label={k("procedures")}
          rows={3}
          value={procedures}
          onChange={(e) => setProcedures(e.target.value)}
          maxLength={2000}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
