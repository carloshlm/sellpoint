import { EXAM_REGIONS } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { cleanFindings, FindingsChecklist, type FindingsValue } from "./findings-checklist";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

function desdeInicial(regions: unknown): FindingsValue {
  const valor: FindingsValue = {};
  if (typeof regions !== "object" || regions === null) return valor;
  for (const [key, item] of Object.entries(regions as Record<string, unknown>)) {
    if (!(EXAM_REGIONS as readonly string[]).includes(key)) continue;
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    if (o.normal === true) valor[key] = { normal: true };
    else if (typeof o.findings === "string") valor[key] = { findings: o.findings };
  }
  return valor;
}

/**
 * F9-CLINIC-HC-16 — Exploración Física por regiones (NOM-004 6.1.2). El
 * habitus exterior se describe arriba; las doce regiones van con «Todo sin
 * alteraciones» y solo se escribe el hallazgo. Absorbe la antigua
 * «Exploración por aparatos y sistemas»: era lo mismo organizado distinto.
 */
export function PhysicalExamForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.physicalExam.${sufijo}`);
  const [habitus, setHabitus] = useState(texto(initialData.habitus));
  const [regions, setRegions] = useState<FindingsValue>(() => desdeInicial(initialData.regions));
  const [notes, setNotes] = useState(texto(initialData.notes));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const data: Record<string, unknown> = {};
    if (habitus.trim()) data.habitus = habitus.trim();
    const limpio = cleanFindings(regions);
    if (Object.keys(limpio).length > 0) data.regions = limpio;
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
        <TextAreaField
          label={k("habitus")}
          placeholder={k("habitusPlaceholder")}
          rows={3}
          value={habitus}
          onChange={(e) => setHabitus(e.target.value)}
          maxLength={1000}
        />
        <FindingsChecklist
          items={EXAM_REGIONS.map((r) => ({ key: r, label: k(`regions.${r}`) }))}
          value={regions}
          onChange={setRegions}
          allNormalLabel={k("allNormal")}
          normalLabel={k("normal")}
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
