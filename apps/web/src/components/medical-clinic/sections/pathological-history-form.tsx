import { CHILDHOOD_DISEASES, CHRONIC_CONDITIONS, INFECTIOUS_DISEASES } from "@sellpoint/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberField } from "@/components/form/number-field";
import { RowList } from "@/components/form/row-list";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { numberFieldError, numberFieldMessage } from "@/lib/measure";
import { SectionFormActions } from "./form-actions";
import { NegatedToggle } from "./negated-toggle";
import type { SectionFormProps } from "./registry";

interface Cronica {
  condition: string;
  otherLabel: string;
  sinceYear: string;
  treatment: string;
}
interface Cirugia {
  procedure: string;
  year: string;
  notes: string;
}
interface Trauma {
  description: string;
  year: string;
}
interface Hospitalizacion {
  reason: string;
  year: string;
}

const texto = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const lista = <T,>(v: unknown, arma: (fila: Record<string, unknown>) => T): T[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]).map(arma) : [];
const ANIO = { decimals: 0, min: 1900, max: new Date().getUTCFullYear() };

/** Un año tecleado, o nada. El rango lo valida `numberFieldError` antes de llegar acá. */
const anio = (raw: string): { year?: number } => (raw.trim() === "" ? {} : { year: Number(raw) });

/**
 * F9-CLINIC-HC-07 — Antecedentes Personales Patológicos: seis bloques.
 *
 * Infancia e infecciosas son checklists; crónico-degenerativas, cirugías,
 * traumatismos y hospitalizaciones son listas de filas; transfusiones es
 * sí/no con detalle. «Negados» arriba, en un clic. Las filas sin su dato
 * principal (la cirugía sin nombre) no viajan: el API solo limpia el primer
 * nivel y shared las rechazaría.
 *
 * Tabaquismo, alcoholismo y toxicomanías van en APNP (HC-08): la NOM los
 * lista aquí, pero los formatos mexicanos los capturan allá y el médico los
 * busca allá.
 */
export function PathologicalHistoryForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const k = (sufijo: string) => t(`medicalClinic.forms.pathologicalHistory.${sufijo}`);
  const [negated, setNegated] = useState(initialData.negated === true);
  const [childhood, setChildhood] = useState<string[]>(
    Array.isArray(initialData.childhood) ? (initialData.childhood as string[]) : [],
  );
  const [chronic, setChronic] = useState<Cronica[]>(
    lista(initialData.chronic, (f) => ({
      condition: texto(f.condition),
      otherLabel: texto(f.otherLabel),
      sinceYear: texto(f.sinceYear),
      treatment: texto(f.treatment),
    })),
  );
  const [surgeries, setSurgeries] = useState<Cirugia[]>(
    lista(initialData.surgeries, (f) => ({
      procedure: texto(f.procedure),
      year: texto(f.year),
      notes: texto(f.notes),
    })),
  );
  const [traumas, setTraumas] = useState<Trauma[]>(
    lista(initialData.traumas, (f) => ({ description: texto(f.description), year: texto(f.year) })),
  );
  const transfusion =
    typeof initialData.transfusions === "object" && initialData.transfusions !== null
      ? (initialData.transfusions as Record<string, unknown>)
      : null;
  const [transfused, setTransfused] = useState(transfusion?.had === true);
  const [transfusionYear, setTransfusionYear] = useState(texto(transfusion?.year));
  const [transfusionReaction, setTransfusionReaction] = useState(texto(transfusion?.reaction));
  const [hospitalizations, setHospitalizations] = useState<Hospitalizacion[]>(
    lista(initialData.hospitalizations, (f) => ({ reason: texto(f.reason), year: texto(f.year) })),
  );
  const [infectious, setInfectious] = useState<string[]>(
    Array.isArray(initialData.infectious) ? (initialData.infectious as string[]) : [],
  );
  const [infectiousNotes, setInfectiousNotes] = useState(texto(initialData.infectiousNotes));
  const [notes, setNotes] = useState(texto(initialData.notes));

  const alternar = (
    valores: string[],
    poner: (v: string[]) => void,
    valor: string,
    marcado: boolean,
  ) => poner(marcado ? [...valores, valor] : valores.filter((v) => v !== valor));

  const errorAnio = (raw: string) => {
    const e = numberFieldError(raw, ANIO);
    return e ? numberFieldMessage(e, t) : undefined;
  };
  const anios = [
    ...chronic.map((c) => c.sinceYear),
    ...surgeries.map((c) => c.year),
    ...traumas.map((c) => c.year),
    ...hospitalizations.map((c) => c.year),
    transfusionYear,
  ];
  const hayAnioInvalido = anios.some((a) => numberFieldError(a, ANIO) !== null);

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (negated) {
      onSubmit({ negated: true });
      return;
    }
    if (hayAnioInvalido) return;
    const data: Record<string, unknown> = {};
    const infancia = CHILDHOOD_DISEASES.filter((d) => childhood.includes(d));
    if (infancia.length > 0) data.childhood = infancia;
    const cronicas = chronic
      .filter((c) => c.condition !== "" && (c.condition !== "other" || c.otherLabel.trim() !== ""))
      .map((c) => ({
        condition: c.condition,
        ...(c.condition === "other" && { otherLabel: c.otherLabel.trim() }),
        ...(c.sinceYear.trim() !== "" && { sinceYear: Number(c.sinceYear) }),
        ...(c.treatment.trim() !== "" && { treatment: c.treatment.trim() }),
      }));
    if (cronicas.length > 0) data.chronic = cronicas;
    const cirugias = surgeries
      .filter((c) => c.procedure.trim() !== "")
      .map((c) => ({
        procedure: c.procedure.trim(),
        ...anio(c.year),
        ...(c.notes.trim() !== "" && { notes: c.notes.trim() }),
      }));
    if (cirugias.length > 0) data.surgeries = cirugias;
    const traumatismos = traumas
      .filter((c) => c.description.trim() !== "")
      .map((c) => ({ description: c.description.trim(), ...anio(c.year) }));
    if (traumatismos.length > 0) data.traumas = traumatismos;
    if (transfused) {
      data.transfusions = {
        had: true,
        ...anio(transfusionYear),
        ...(transfusionReaction.trim() !== "" && { reaction: transfusionReaction.trim() }),
      };
    }
    const hospitalizaciones = hospitalizations
      .filter((c) => c.reason.trim() !== "")
      .map((c) => ({ reason: c.reason.trim(), ...anio(c.year) }));
    if (hospitalizaciones.length > 0) data.hospitalizations = hospitalizaciones;
    const infecciosas = INFECTIOUS_DISEASES.filter((d) => infectious.includes(d));
    if (infecciosas.length > 0) data.infectious = infecciosas;
    if (infectiousNotes.trim() !== "") data.infectiousNotes = infectiousNotes.trim();
    if (notes.trim() !== "") data.notes = notes.trim();
    onSubmit(data);
  };

  const opcionesCronicas = [
    { value: "", label: t("medicalClinic.forms.chooseOption") },
    ...CHRONIC_CONDITIONS.map((c) => ({ value: c, label: k(`chronicOptions.${c}`) })),
  ];

  const checklist = (
    nombre: string,
    valores: readonly string[],
    marcados: string[],
    poner: (v: string[]) => void,
    prefijo: string,
  ) => (
    <fieldset className="flex flex-col gap-2">
      <legend className="font-medium text-sm">{k(nombre)}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {valores.map((valor) => {
          const inputId = `${id}-${prefijo}-${valor}`;
          return (
            <div key={valor} className="flex items-center gap-1.5">
              <Checkbox
                id={inputId}
                checked={marcados.includes(valor)}
                onCheckedChange={(next) => alternar(marcados, poner, valor, next === true)}
              />
              <Label htmlFor={inputId} className="font-normal">
                {k(`${prefijo}Options.${valor}`)}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );

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
      <fieldset disabled={negated || readOnly || busy} className="flex flex-col gap-6">
        {checklist("childhood", CHILDHOOD_DISEASES, childhood, setChildhood, "childhood")}

        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-sm">{k("chronic")}</legend>
          <RowList
            rows={chronic}
            onChange={setChronic}
            emptyRow={() => ({ condition: "", otherLabel: "", sinceYear: "", treatment: "" })}
            addLabel={k("addChronic")}
            label={k("chronic")}
            render={(row, patch) => (
              <>
                <SelectField
                  label={k("chronicCondition")}
                  options={opcionesCronicas}
                  value={row.condition}
                  onChange={(e) => patch({ condition: e.target.value })}
                />
                {row.condition === "other" ? (
                  <TextField
                    label={k("otherLabel")}
                    value={row.otherLabel}
                    onChange={(e) => patch({ otherLabel: e.target.value })}
                    maxLength={80}
                  />
                ) : null}
                <NumberField
                  label={k("sinceYear")}
                  decimals={0}
                  value={row.sinceYear}
                  onChange={(v) => patch({ sinceYear: v })}
                  error={errorAnio(row.sinceYear)}
                />
                <TextField
                  label={k("treatment")}
                  value={row.treatment}
                  onChange={(e) => patch({ treatment: e.target.value })}
                  maxLength={200}
                />
              </>
            )}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-sm">{k("surgeries")}</legend>
          <RowList
            rows={surgeries}
            onChange={setSurgeries}
            emptyRow={() => ({ procedure: "", year: "", notes: "" })}
            addLabel={k("addSurgery")}
            label={k("surgeries")}
            render={(row, patch) => (
              <>
                <TextField
                  label={k("procedure")}
                  value={row.procedure}
                  onChange={(e) => patch({ procedure: e.target.value })}
                  maxLength={120}
                />
                <NumberField
                  label={k("year")}
                  decimals={0}
                  value={row.year}
                  onChange={(v) => patch({ year: v })}
                  error={errorAnio(row.year)}
                />
                <TextField
                  className="sm:col-span-2"
                  label={k("rowNotes")}
                  value={row.notes}
                  onChange={(e) => patch({ notes: e.target.value })}
                  maxLength={200}
                />
              </>
            )}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-sm">{k("traumas")}</legend>
          <RowList
            rows={traumas}
            onChange={setTraumas}
            emptyRow={() => ({ description: "", year: "" })}
            addLabel={k("addTrauma")}
            label={k("traumas")}
            render={(row, patch) => (
              <>
                <TextField
                  label={k("traumaDescription")}
                  value={row.description}
                  onChange={(e) => patch({ description: e.target.value })}
                  maxLength={200}
                />
                <NumberField
                  label={k("year")}
                  decimals={0}
                  value={row.year}
                  onChange={(v) => patch({ year: v })}
                  error={errorAnio(row.year)}
                />
              </>
            )}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="font-medium text-sm">{k("transfusions")}</legend>
          <div className="flex items-center gap-2">
            <Checkbox
              id={`${id}-transfused`}
              checked={transfused}
              onCheckedChange={(next) => setTransfused(next === true)}
            />
            <Label htmlFor={`${id}-transfused`} className="font-normal">
              {k("transfused")}
            </Label>
          </div>
          {transfused ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label={k("year")}
                decimals={0}
                value={transfusionYear}
                onChange={setTransfusionYear}
                error={errorAnio(transfusionYear)}
              />
              <TextField
                label={k("transfusionReaction")}
                value={transfusionReaction}
                onChange={(e) => setTransfusionReaction(e.target.value)}
                maxLength={200}
              />
            </div>
          ) : null}
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="font-medium text-sm">{k("hospitalizations")}</legend>
          <RowList
            rows={hospitalizations}
            onChange={setHospitalizations}
            emptyRow={() => ({ reason: "", year: "" })}
            addLabel={k("addHospitalization")}
            label={k("hospitalizations")}
            render={(row, patch) => (
              <>
                <TextField
                  label={k("hospitalizationReason")}
                  value={row.reason}
                  onChange={(e) => patch({ reason: e.target.value })}
                  maxLength={200}
                />
                <NumberField
                  label={k("year")}
                  decimals={0}
                  value={row.year}
                  onChange={(v) => patch({ year: v })}
                  error={errorAnio(row.year)}
                />
              </>
            )}
          />
        </fieldset>

        <div className="flex flex-col gap-3">
          {checklist("infectious", INFECTIOUS_DISEASES, infectious, setInfectious, "infectious")}
          <TextField
            label={k("infectiousNotes")}
            value={infectiousNotes}
            onChange={(e) => setInfectiousNotes(e.target.value)}
            maxLength={500}
          />
        </div>

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
