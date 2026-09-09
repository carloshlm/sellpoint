import { bmi, bmiCategory, parseMeasure } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberField } from "@/components/form/number-field";
import { type NumberRule, numberFieldError, numberFieldMessage } from "@/lib/measure";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

const REGLAS: Record<string, NumberRule & { unit: string }> = {
  weightKg: { decimals: 1, min: 0.5, max: 500, unit: "kg" },
  heightCm: { decimals: 1, min: 20, max: 250, unit: "cm" },
  headCircumferenceCm: { decimals: 1, min: 20, max: 70, unit: "cm" },
  waistCm: { decimals: 1, min: 30, max: 250, unit: "cm" },
  hipCm: { decimals: 1, min: 30, max: 250, unit: "cm" },
};
const CAMPOS = Object.keys(REGLAS);

/**
 * F9-CLINIC-HC-14 — Somatometría: peso, talla y perímetros. El IMC y su
 * categoría OMS se calculan al lado (`bmi`, `bmiCategory` en shared) y NO
 * se guardan: cambia el peso y un IMC guardado se quedaría viejo. Para
 * menores de 18 el IMC se pinta sin categoría: los cortes OMS son de
 * adulto y los percentiles pediátricos están pospuestos con nombre.
 */
export function AnthropometryForm({
  initialData,
  patientAge,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string, args?: Record<string, string>) =>
    t(`medicalClinic.forms.anthropometry.${sufijo}`, args);
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(CAMPOS.map((c) => [c, texto(initialData[c])])),
  );
  const poner = (campo: string) => (valor: string) =>
    setValores((previo) => ({ ...previo, [campo]: valor }));
  const errorDe = (campo: string) => {
    const e = numberFieldError(valores[campo] ?? "", REGLAS[campo] as NumberRule);
    return e ? numberFieldMessage(e, t) : undefined;
  };
  const hayError = CAMPOS.some((c) => errorDe(c) !== undefined);

  const imc = bmi(parseMeasure(valores.weightKg ?? "", 1), parseMeasure(valores.heightCm ?? "", 1));
  const esAdulto = patientAge === null || patientAge >= 18;
  const categoria = imc !== null && esAdulto ? bmiCategory(imc) : null;

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (hayError) return;
    const data: Record<string, unknown> = {};
    for (const campo of CAMPOS) {
      const n = parseMeasure(valores[campo] ?? "", REGLAS[campo]?.decimals ?? 1);
      if (n !== null) data[campo] = n;
    }
    onSubmit(data);
  };

  const campo = (nombre: string, hint?: string) => {
    const regla = REGLAS[nombre] as NumberRule & { unit: string };
    return (
      <NumberField
        label={k(nombre)}
        unit={regla.unit}
        decimals={regla.decimals}
        value={valores[nombre] ?? ""}
        onChange={poner(nombre)}
        error={errorDe(nombre)}
        hint={hint}
      />
    );
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {campo("weightKg")}
          {campo("heightCm")}
        </div>
        {imc !== null ? (
          <p
            data-testid="bmi"
            className={
              categoria !== null && categoria !== "normal"
                ? "font-medium text-sm text-warning"
                : "font-medium text-sm"
            }
          >
            {k("bmi", { value: imc.toFixed(1) })}
            {categoria !== null ? ` · ${k(`bmiCategory.${categoria}`)}` : ""}
            {!esAdulto ? (
              <span className="ml-2 font-normal text-muted-foreground text-xs">
                {k("pediatricHint")}
              </span>
            ) : null}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-3">
          {campo("headCircumferenceCm", k("headCircumferenceHint"))}
          {campo("waistCm")}
          {campo("hipCm")}
        </div>
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
