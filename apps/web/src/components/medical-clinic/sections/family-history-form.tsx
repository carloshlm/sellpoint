import { FAMILY_CONDITIONS, RELATIVES } from "@sellpoint/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SectionFormActions } from "./form-actions";
import { NegatedToggle } from "./negated-toggle";
import type { SectionFormProps } from "./registry";

type Condition = (typeof FAMILY_CONDITIONS)[number];
type Relative = (typeof RELATIVES)[number];

interface Antecedente {
  relatives: Relative[];
  otherLabel: string;
  notes: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** Lo guardado, de vuelta al estado: una entrada por enfermedad marcada. */
function desdeInicial(
  initialData: Record<string, unknown>,
): Partial<Record<Condition, Antecedente>> {
  const conditions = Array.isArray(initialData.conditions) ? initialData.conditions : [];
  const estado: Partial<Record<Condition, Antecedente>> = {};
  for (const fila of conditions as Record<string, unknown>[]) {
    const condition = fila.condition;
    if (
      typeof condition !== "string" ||
      !(FAMILY_CONDITIONS as readonly string[]).includes(condition)
    )
      continue;
    const relatives = Array.isArray(fila.relatives)
      ? (fila.relatives.filter((r) =>
          (RELATIVES as readonly string[]).includes(r as string),
        ) as Relative[])
      : [];
    estado[condition as Condition] = {
      relatives,
      otherLabel: texto(fila.otherLabel),
      notes: texto(fila.notes),
    };
  }
  return estado;
}

/**
 * F9-CLINIC-HC-06 — Antecedentes Heredofamiliares: enfermedad × parentesco.
 *
 * El médico marca la enfermedad y aparecen los parentescos como chips; lo
 * demás queda quieto. «Negados» arriba, en un clic, y se guarda explícito.
 * Una enfermedad marcada SIN parentesco no viaja: shared la rechazaría, y un
 * antecedente sin «en quién» no dice nada.
 */
export function FamilyHistoryForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const k = (sufijo: string, args?: Record<string, string>) =>
    t(`medicalClinic.forms.familyHistory.${sufijo}`, args);
  const [negated, setNegated] = useState(initialData.negated === true);
  const [antecedentes, setAntecedentes] = useState(() => desdeInicial(initialData));
  const [notes, setNotes] = useState(texto(initialData.notes));

  const alternar = (condition: Condition, marcada: boolean) => {
    setAntecedentes((previo) => {
      const siguiente = { ...previo };
      if (marcada) siguiente[condition] = { relatives: [], otherLabel: "", notes: "" };
      else delete siguiente[condition];
      return siguiente;
    });
  };
  const editar = (condition: Condition, cambios: Partial<Antecedente>) =>
    setAntecedentes((previo) => ({
      ...previo,
      [condition]: {
        ...(previo[condition] ?? { relatives: [], otherLabel: "", notes: "" }),
        ...cambios,
      },
    }));
  const alternarParentesco = (condition: Condition, relative: Relative, marcado: boolean) => {
    const actual = antecedentes[condition]?.relatives ?? [];
    editar(condition, {
      relatives: marcado ? [...actual, relative] : actual.filter((r) => r !== relative),
    });
  };

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (negated) {
      onSubmit({ negated: true });
      return;
    }
    const conditions = FAMILY_CONDITIONS.flatMap((condition) => {
      const a = antecedentes[condition];
      if (a === undefined || a.relatives.length === 0) return [];
      // «Otra» sin nombre no dice nada: tampoco viaja.
      if (condition === "other" && a.otherLabel.trim() === "") return [];
      // El orden de los chips, no el del clic: así el JSON es estable.
      const relatives = RELATIVES.filter((r) => a.relatives.includes(r));
      return [
        {
          condition,
          relatives,
          ...(condition === "other" &&
            a.otherLabel.trim() !== "" && { otherLabel: a.otherLabel.trim() }),
          ...(a.notes.trim() !== "" && { notes: a.notes.trim() }),
        },
      ];
    });
    const data: Record<string, unknown> = {};
    if (conditions.length > 0) data.conditions = conditions;
    if (notes.trim() !== "") data.notes = notes.trim();
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
        checked={negated}
        onChange={setNegated}
        label={k("negated")}
        hint={k("negatedHint")}
        disabled={readOnly || busy}
      />
      <fieldset disabled={negated || readOnly || busy} className="flex flex-col gap-4">
        <legend className="font-medium text-sm">{k("conditionsLegend")}</legend>
        <ul className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          {FAMILY_CONDITIONS.map((condition) => {
            const marcada = antecedentes[condition] !== undefined;
            const inputId = `${id}-${condition}`;
            const a = antecedentes[condition];
            return (
              <li key={condition} className={marcada ? "flex flex-col gap-2 sm:col-span-2" : ""}>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={inputId}
                    checked={marcada}
                    onCheckedChange={(next) => alternar(condition, next === true)}
                  />
                  <Label htmlFor={inputId}>{k(`conditions.${condition}`)}</Label>
                </div>
                {marcada && a ? (
                  <div className="ml-6 flex flex-col gap-2 rounded-md border bg-muted/30 p-3">
                    <fieldset className="flex flex-wrap gap-x-4 gap-y-2">
                      <legend className="mb-1 text-muted-foreground text-xs">
                        {k("relativesLegend", { condition: k(`conditions.${condition}`) })}
                      </legend>
                      {RELATIVES.map((relative) => {
                        const chipId = `${inputId}-${relative}`;
                        return (
                          <div key={relative} className="flex items-center gap-1.5">
                            <Checkbox
                              id={chipId}
                              checked={a.relatives.includes(relative)}
                              onCheckedChange={(next) =>
                                alternarParentesco(condition, relative, next === true)
                              }
                            />
                            <Label htmlFor={chipId} className="font-normal">
                              {k(`relatives.${relative}`)}
                            </Label>
                          </div>
                        );
                      })}
                    </fieldset>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {condition === "other" ? (
                        <TextField
                          label={k("otherLabel")}
                          value={a.otherLabel}
                          onChange={(e) => editar(condition, { otherLabel: e.target.value })}
                          maxLength={80}
                        />
                      ) : null}
                      <TextField
                        label={k("conditionNotes", { condition: k(`conditions.${condition}`) })}
                        value={a.notes}
                        onChange={(e) => editar(condition, { notes: e.target.value })}
                        maxLength={200}
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <TextAreaField
          label={k("notes")}
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
