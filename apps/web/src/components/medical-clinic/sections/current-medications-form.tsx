import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RowList } from "@/components/form/row-list";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { SectionFormActions } from "./form-actions";
import { NegatedToggle } from "./negated-toggle";
import type { SectionFormProps } from "./registry";

interface Medicamento {
  name: string;
  dose: string;
  frequency: string;
  reason: string;
  since: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * F9-CLINIC-HC-11 — Medicamentos Actuales: «No toma medicamentos» en un
 * clic (`none: true`, la misma primitiva del negado), o una lista con
 * nombre, dosis, frecuencia, motivo y desde cuándo. Una fila sin nombre no
 * viaja.
 */
export function CurrentMedicationsForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.currentMedications.${sufijo}`);
  const [none, setNone] = useState(initialData.none === true);
  const [items, setItems] = useState<Medicamento[]>(
    Array.isArray(initialData.items)
      ? (initialData.items as Record<string, unknown>[]).map((f) => ({
          name: texto(f.name),
          dose: texto(f.dose),
          frequency: texto(f.frequency),
          reason: texto(f.reason),
          since: texto(f.since),
        }))
      : [],
  );
  const [notes, setNotes] = useState(texto(initialData.notes));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (none) {
      onSubmit({ none: true });
      return;
    }
    const lista = items
      .filter((m) => m.name.trim() !== "")
      .map((m) => ({
        name: m.name.trim(),
        ...(m.dose.trim() && { dose: m.dose.trim() }),
        ...(m.frequency.trim() && { frequency: m.frequency.trim() }),
        ...(m.reason.trim() && { reason: m.reason.trim() }),
        ...(m.since.trim() && { since: m.since.trim() }),
      }));
    const data: Record<string, unknown> = {};
    if (lista.length > 0) data.items = lista;
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
      <NegatedToggle
        checked={none}
        onChange={setNone}
        label={k("none")}
        hint={k("noneHint")}
        disabled={readOnly || busy}
      />
      <fieldset disabled={none || readOnly || busy} className="flex flex-col gap-3">
        <legend className="font-medium text-sm">{k("list")}</legend>
        <RowList
          rows={items}
          onChange={setItems}
          emptyRow={() => ({ name: "", dose: "", frequency: "", reason: "", since: "" })}
          addLabel={k("add")}
          label={k("list")}
          render={(row, patch) => (
            <>
              <TextField
                label={k("name")}
                value={row.name}
                onChange={(e) => patch({ name: e.target.value })}
                maxLength={120}
              />
              <TextField
                label={k("dose")}
                placeholder={k("dosePlaceholder")}
                value={row.dose}
                onChange={(e) => patch({ dose: e.target.value })}
                maxLength={60}
              />
              <TextField
                label={k("frequency")}
                placeholder={k("frequencyPlaceholder")}
                value={row.frequency}
                onChange={(e) => patch({ frequency: e.target.value })}
                maxLength={60}
              />
              <TextField
                label={k("reason")}
                value={row.reason}
                onChange={(e) => patch({ reason: e.target.value })}
                maxLength={120}
              />
              <TextField
                label={k("since")}
                placeholder={k("sincePlaceholder")}
                value={row.since}
                onChange={(e) => patch({ since: e.target.value })}
                maxLength={40}
              />
            </>
          )}
        />
        <TextAreaField
          label={k("notes")}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
