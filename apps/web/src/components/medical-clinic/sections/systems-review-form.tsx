import { REVIEW_SYSTEMS } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { cleanFindings, FindingsChecklist, type FindingsValue } from "./findings-checklist";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** Lo guardado, de vuelta al valor del checklist: solo lo que tiene forma válida. */
function desdeInicial(systems: unknown): FindingsValue {
  const valor: FindingsValue = {};
  if (typeof systems !== "object" || systems === null) return valor;
  for (const [key, item] of Object.entries(systems as Record<string, unknown>)) {
    if (!(REVIEW_SYSTEMS as readonly string[]).includes(key)) continue;
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (o.normal === true) valor[key] = { normal: true };
    else if (typeof o.findings === "string") valor[key] = { findings: o.findings };
  }
  return valor;
}

/**
 * F9-CLINIC-HC-12 — Interrogatorio por Aparatos y Sistemas: once sistemas,
 * cada uno «interrogado y negado» o «con síntomas» y su texto. «Todos
 * negados» arriba pone los once en negado explícito, POR SISTEMA (no una
 * marca en la raíz): así el que sí tiene síntomas se cambia solo y el JSON
 * dice exactamente qué se preguntó. Cada sistema lleva sus síntomas
 * cardinales como guía.
 */
export function SystemsReviewForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.systemsReview.${sufijo}`);
  const [systems, setSystems] = useState<FindingsValue>(() => desdeInicial(initialData.systems));
  const [notes, setNotes] = useState(texto(initialData.notes));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const limpio = cleanFindings(systems);
    const data: Record<string, unknown> = {};
    if (Object.keys(limpio).length > 0) data.systems = limpio;
    if (notes.trim()) data.notes = notes.trim();
    onSubmit(data);
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-4">
        <FindingsChecklist
          items={REVIEW_SYSTEMS.map((s) => ({
            key: s,
            label: k(`systems.${s}`),
            hint: k(`hints.${s}`),
          }))}
          value={systems}
          onChange={setSystems}
          allNormalLabel={k("allNegated")}
          normalLabel={k("negated")}
          findingsLabel={k("findings")}
          findingsPlaceholder={k("findingsPlaceholder")}
          disabled={readOnly || busy}
        />
        <TextAreaField
          label={k("notes")}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
