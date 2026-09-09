import {
  CONTRACEPTION_METHODS,
  expectedDeliveryDate,
  localCalendarDate,
  SCREENING_RESULTS,
} from "@sellpoint/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberField } from "@/components/form/number-field";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatCalendarDate } from "@/lib/inventory/format-date";
import { type NumberRule, numberFieldError, numberFieldMessage } from "@/lib/measure";
import { useAuthStore } from "@/stores/auth.store";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const objeto = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

const REGLAS: Record<string, NumberRule> = {
  menarcheAge: { decimals: 0, min: 8, max: 20 },
  cycleDays: { decimals: 0, min: 15, max: 90 },
  periodDays: { decimals: 0, min: 1, max: 15 },
  sexualDebutAge: { decimals: 0, min: 8, max: 60 },
  partners: { decimals: 0, min: 0, max: 99 },
  gestations: { decimals: 0, min: 0, max: 30 },
  births: { decimals: 0, min: 0, max: 30 },
  abortions: { decimals: 0, min: 0, max: 30 },
  cesareans: { decimals: 0, min: 0, max: 30 },
  menopauseAge: { decimals: 0, min: 30, max: 70 },
};
const ENTEROS = Object.keys(REGLAS);

/**
 * F9-CLINIC-HC-09 — Antecedentes Gineco-Obstétricos. Menarca, ritmo, FUM,
 * IVSA, G/P/A/C, MPF, tamizajes, menopausia. La FPP se calcula desde la FUM
 * al marcar «embarazo actual» (Naegele, en shared) y no se guarda. La suma
 * P + A + C suele igualar G, pero un embarazo en curso lo rompe: es aviso,
 * no error.
 */
export function GynecoObstetricForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const k = (sufijo: string, args?: Record<string, string>) =>
    t(`medicalClinic.forms.gynecoObstetric.${sufijo}`, args);
  const timezone = useAuthStore((s) => s.user?.tenant.timezone);
  const hoy = localCalendarDate(timezone ?? "UTC", new Date());
  const pap = objeto(initialData.papSmear);
  const mamo = objeto(initialData.mammogram);

  const [enteros, setEnteros] = useState<Record<string, string>>(
    Object.fromEntries(ENTEROS.map((c) => [c, texto(initialData[c])])),
  );
  const [lastPeriodDate, setLastPeriodDate] = useState(texto(initialData.lastPeriodDate));
  const [contraception, setContraception] = useState(texto(initialData.contraception));
  const [papDate, setPapDate] = useState(texto(pap.date));
  const [papResult, setPapResult] = useState(texto(pap.result));
  const [mammoDate, setMammoDate] = useState(texto(mamo.date));
  const [mammoResult, setMammoResult] = useState(texto(mamo.result));
  const [pregnant, setPregnant] = useState(initialData.pregnant === true);
  const [breastfeeding, setBreastfeeding] = useState(initialData.breastfeeding === true);
  const [notes, setNotes] = useState(texto(initialData.notes));

  const poner = (campo: string) => (valor: string) =>
    setEnteros((previo) => ({ ...previo, [campo]: valor }));
  const errorDe = (campo: string) => {
    const e = numberFieldError(enteros[campo] ?? "", REGLAS[campo] as NumberRule);
    return e ? numberFieldMessage(e, t) : undefined;
  };
  const hayError = ENTEROS.some((c) => errorDe(c) !== undefined);
  const numero = (campo: string): number | null => {
    const raw = (enteros[campo] ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const g = numero("gestations");
  const suma = (numero("births") ?? 0) + (numero("abortions") ?? 0) + (numero("cesareans") ?? 0);
  const avisoGpac = g !== null && suma !== g ? k("gpacHint") : undefined;
  const fpp = pregnant && lastPeriodDate ? expectedDeliveryDate(lastPeriodDate) : null;

  const opcionesResultado = [
    { value: "", label: t("medicalClinic.forms.chooseOption") },
    ...SCREENING_RESULTS.map((r) => ({ value: r, label: k(`resultOptions.${r}`) })),
  ];

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (hayError) return;
    const data: Record<string, unknown> = {};
    for (const campo of ENTEROS) {
      const n = numero(campo);
      if (n !== null) data[campo] = n;
    }
    if (lastPeriodDate) data.lastPeriodDate = lastPeriodDate;
    if (contraception) data.contraception = contraception;
    if (papDate || papResult) {
      data.papSmear = {
        ...(papDate && { date: papDate }),
        ...(papResult && { result: papResult }),
      };
    }
    if (mammoDate || mammoResult) {
      data.mammogram = {
        ...(mammoDate && { date: mammoDate }),
        ...(mammoResult && { result: mammoResult }),
      };
    }
    if (pregnant) data.pregnant = true;
    if (breastfeeding) data.breastfeeding = true;
    if (notes.trim()) data.notes = notes.trim();
    onSubmit(data);
  };

  const entero = (campo: string, hint?: string) => (
    <NumberField
      label={k(campo)}
      decimals={0}
      value={enteros[campo] ?? ""}
      onChange={poner(campo)}
      error={errorDe(campo)}
      hint={hint}
    />
  );

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-6">
        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("menstrual")}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {entero("menarcheAge")}
            {entero("cycleDays")}
            {entero("periodDays")}
            <TextField
              label={k("lastPeriodDate")}
              type="date"
              max={hoy}
              value={lastPeriodDate}
              onChange={(e) => setLastPeriodDate(e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("sexual")}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {entero("sexualDebutAge")}
            {entero("partners")}
            <SelectField
              label={k("contraception")}
              options={[
                { value: "", label: t("medicalClinic.forms.chooseOption") },
                ...CONTRACEPTION_METHODS.map((m) => ({
                  value: m,
                  label: k(`contraceptionOptions.${m}`),
                })),
              ]}
              value={contraception}
              onChange={(e) => setContraception(e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("obstetric")}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {entero("gestations", avisoGpac)}
            {entero("births")}
            {entero("abortions")}
            {entero("cesareans")}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-pregnant`}
                checked={pregnant}
                onCheckedChange={(next) => setPregnant(next === true)}
              />
              <Label htmlFor={`${id}-pregnant`} className="font-normal">
                {k("pregnant")}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${id}-breastfeeding`}
                checked={breastfeeding}
                onCheckedChange={(next) => setBreastfeeding(next === true)}
              />
              <Label htmlFor={`${id}-breastfeeding`} className="font-normal">
                {k("breastfeeding")}
              </Label>
            </div>
          </div>
          {pregnant ? (
            <p className="text-sm" data-testid="edd">
              {fpp
                ? k("edd", { date: formatCalendarDate(fpp, i18n.language) })
                : k("eddNeedsLastPeriod")}
            </p>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("screening")}</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <TextField
              label={k("papSmearDate")}
              type="date"
              max={hoy}
              value={papDate}
              onChange={(e) => setPapDate(e.target.value)}
            />
            <SelectField
              label={k("papSmearResult")}
              options={opcionesResultado}
              value={papResult}
              onChange={(e) => setPapResult(e.target.value)}
            />
            <TextField
              label={k("mammogramDate")}
              type="date"
              max={hoy}
              value={mammoDate}
              onChange={(e) => setMammoDate(e.target.value)}
            />
            <SelectField
              label={k("mammogramResult")}
              options={opcionesResultado}
              value={mammoResult}
              onChange={(e) => setMammoResult(e.target.value)}
            />
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          {entero("menopauseAge")}
          <TextAreaField
            className="sm:col-span-2"
            label={k("notes")}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
          />
        </div>
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
