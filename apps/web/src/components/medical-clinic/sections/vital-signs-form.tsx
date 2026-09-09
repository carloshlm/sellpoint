import {
  parseMeasure,
  VITAL_SIGN_RANGES,
  type VitalSignKey,
  vitalSignFlag,
} from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberField } from "@/components/form/number-field";
import { SelectField } from "@/components/form/select-field";
import { type NumberRule, numberFieldError, numberFieldMessage } from "@/lib/measure";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

const texto = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";

const REGLAS: Record<Exclude<VitalSignKey, "painScale">, NumberRule & { unit: string }> = {
  systolic: { decimals: 0, min: 40, max: 300, unit: "mmHg" },
  diastolic: { decimals: 0, min: 20, max: 200, unit: "mmHg" },
  heartRate: { decimals: 0, min: 20, max: 300, unit: "lpm" },
  respiratoryRate: { decimals: 0, min: 5, max: 80, unit: "rpm" },
  temperatureC: { decimals: 1, min: 30, max: 45, unit: "°C" },
  oxygenSaturation: { decimals: 0, min: 50, max: 100, unit: "%" },
  capillaryGlucoseMgDl: { decimals: 0, min: 20, max: 800, unit: "mg/dL" },
};
type Campo = keyof typeof REGLAS;
const CAMPOS = Object.keys(REGLAS) as Campo[];

/** Alarma (rojo) por encima del simple «alto»: TA ≥ 180/110, SpO2 < 90, T ≥ 39. */
function esAlarma(campo: Campo, valor: number): boolean {
  if (campo === "systolic") return valor >= 180;
  if (campo === "diastolic") return valor >= 110;
  if (campo === "oxygenSaturation") return valor < 90;
  if (campo === "temperatureC") return valor >= 39;
  return false;
}

/**
 * F9-CLINIC-HC-15 — Signos Vitales con semáforo. Cada campo dice su rango
 * normal de adulto y, con el valor puesto, «Alto» o «Bajo» en ámbar o en
 * rojo cuando es alarma (`vitalSignFlag` en shared). El semáforo se apaga
 * para menores de 12 años: los rangos son de adulto y una FC de 120 es
 * normal a los 2 años. El dolor (EVA 0-10) no tiene rango: es lo que dice
 * el paciente.
 */
export function VitalSignsForm({
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
    t(`medicalClinic.forms.vitalSigns.${sufijo}`, args);
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(CAMPOS.map((c) => [c, texto(initialData[c])])),
  );
  const [painScale, setPainScale] = useState(texto(initialData.painScale));
  const semaforo = patientAge === null || patientAge >= 12;

  const poner = (campo: Campo) => (valor: string) =>
    setValores((previo) => ({ ...previo, [campo]: valor }));
  const errorDe = (campo: Campo) => {
    const e = numberFieldError(valores[campo] ?? "", REGLAS[campo]);
    return e ? numberFieldMessage(e, t) : undefined;
  };
  const sistolica = parseMeasure(valores.systolic ?? "", 0);
  const diastolica = parseMeasure(valores.diastolic ?? "", 0);
  const errorTa =
    sistolica !== null && diastolica !== null && diastolica >= sistolica
      ? k("diastolicNotBelow")
      : undefined;
  const hayError = CAMPOS.some((c) => errorDe(c) !== undefined) || errorTa !== undefined;

  const pista = (campo: Campo): { hint: string; tone: "muted" | "warning" | "destructive" } => {
    const rango = VITAL_SIGN_RANGES[campo];
    const normal = rango
      ? k("normalRange", { min: String(rango.min), max: String(rango.max) })
      : "";
    const valor = parseMeasure(valores[campo] ?? "", REGLAS[campo].decimals);
    if (!semaforo || valor === null) return { hint: normal, tone: "muted" };
    const flag = vitalSignFlag(campo, valor);
    if (flag === "normal") return { hint: normal, tone: "muted" };
    return {
      hint: `${k(flag === "high" ? "high" : "low")} · ${normal}`,
      tone: esAlarma(campo, valor) ? "destructive" : "warning",
    };
  };

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (hayError) return;
    const data: Record<string, unknown> = {};
    for (const campo of CAMPOS) {
      const n = parseMeasure(valores[campo] ?? "", REGLAS[campo].decimals);
      if (n !== null) data[campo] = n;
    }
    if (painScale !== "") data.painScale = Number(painScale);
    onSubmit(data);
  };

  const campo = (nombre: Campo, errorExtra?: string) => {
    const { hint, tone } = pista(nombre);
    return (
      <NumberField
        label={k(nombre)}
        unit={REGLAS[nombre].unit}
        decimals={REGLAS[nombre].decimals}
        value={valores[nombre] ?? ""}
        onChange={poner(nombre)}
        error={errorDe(nombre) ?? errorExtra}
        hint={hint}
        hintTone={tone}
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
        {!semaforo ? <p className="text-muted-foreground text-xs">{k("pediatricHint")}</p> : null}
        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 font-medium text-sm">{k("bloodPressure")}</legend>
          {campo("systolic")}
          {campo("diastolic", errorTa)}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {campo("heartRate")}
          {campo("respiratoryRate")}
          {campo("temperatureC")}
          {campo("oxygenSaturation")}
          {campo("capillaryGlucoseMgDl")}
          <SelectField
            label={k("painScale")}
            hint={k("painScaleHint")}
            options={[
              { value: "", label: t("medicalClinic.forms.chooseOption") },
              ...Array.from({ length: 11 }, (_, i) => ({
                value: String(i),
                label: i === 0 ? k("painNone") : i === 10 ? k("painWorst") : String(i),
              })),
            ]}
            value={painScale}
            onChange={(e) => setPainScale(e.target.value)}
          />
        </div>
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
