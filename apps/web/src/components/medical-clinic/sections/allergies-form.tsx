import { ALLERGY_KINDS, ALLERGY_SEVERITIES } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RowList } from "@/components/form/row-list";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { SectionFormActions } from "./form-actions";
import { NegatedToggle } from "./negated-toggle";
import type { SectionFormProps } from "./registry";

interface Alergia {
  kind: string;
  substance: string;
  reaction: string;
  severity: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * F9-CLINIC-HC-10 — Alergias: negadas en un clic, o una lista con tipo,
 * sustancia, reacción y gravedad. Es la sección que sube al encabezado en
 * rojo (HC-13): lo que se guarda aquí lo ve el médico en cada pantalla del
 * expediente. Una fila sin sustancia no viaja.
 */
export function AllergiesForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.allergies.${sufijo}`);
  const [negated, setNegated] = useState(initialData.negated === true);
  const [items, setItems] = useState<Alergia[]>(
    Array.isArray(initialData.items)
      ? (initialData.items as Record<string, unknown>[]).map((f) => ({
          kind: texto(f.kind),
          substance: texto(f.substance),
          reaction: texto(f.reaction),
          severity: texto(f.severity),
        }))
      : [],
  );

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (negated) {
      onSubmit({ negated: true });
      return;
    }
    const lista = items
      .filter((a) => a.substance.trim() !== "")
      .map((a) => ({
        kind: a.kind || "other",
        substance: a.substance.trim(),
        ...(a.reaction.trim() && { reaction: a.reaction.trim() }),
        ...(a.severity && { severity: a.severity }),
      }));
    onSubmit(lista.length > 0 ? { items: lista } : {});
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <NegatedToggle
        checked={negated}
        onChange={setNegated}
        label={k("negated")}
        hint={k("negatedHint")}
        disabled={readOnly || busy}
      />
      <fieldset disabled={negated || readOnly || busy} className="flex flex-col gap-3">
        <legend className="font-medium text-sm">{k("list")}</legend>
        <RowList
          rows={items}
          onChange={setItems}
          emptyRow={() => ({ kind: "drug", substance: "", reaction: "", severity: "" })}
          addLabel={k("add")}
          label={k("list")}
          render={(row, patch) => (
            <>
              <SelectField
                label={k("kind")}
                options={ALLERGY_KINDS.map((v) => ({ value: v, label: k(`kindOptions.${v}`) }))}
                value={row.kind}
                onChange={(e) => patch({ kind: e.target.value })}
              />
              <TextField
                label={k("substance")}
                value={row.substance}
                onChange={(e) => patch({ substance: e.target.value })}
                maxLength={120}
              />
              <TextField
                label={k("reaction")}
                value={row.reaction}
                onChange={(e) => patch({ reaction: e.target.value })}
                maxLength={200}
              />
              <SelectField
                label={k("severity")}
                options={[
                  { value: "", label: t("medicalClinic.forms.chooseOption") },
                  ...ALLERGY_SEVERITIES.map((v) => ({
                    value: v,
                    label: k(`severityOptions.${v}`),
                  })),
                ]}
                value={row.severity}
                onChange={(e) => patch({ severity: e.target.value })}
              />
            </>
          )}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
