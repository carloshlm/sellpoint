import { localCalendarDate, STUDY_INTERPRETATIONS, STUDY_RESULT_KINDS } from "@sellpoint/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { RowList } from "@/components/form/row-list";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { useStudies } from "@/lib/medical-clinic/hooks";
import { useAuthStore } from "@/stores/auth.store";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

interface Resultado {
  kind: string;
  name: string;
  studyId: string;
  date: string;
  result: string;
  interpretation: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * El nombre del estudio con autocompletado desde el catálogo del negocio
 * (laboratorio o diagnóstico). Elegir una opción guarda `studyId`; escribir
 * a mano lo deja vacío. Es un componente aparte para poder usar el hook por
 * fila.
 */
function StudyNameField({
  kind,
  value,
  onChange,
  label,
}: {
  kind: string;
  value: string;
  onChange: (name: string, studyId: string) => void;
  label: string;
}) {
  const listId = useId();
  const catalogo = kind === "lab" ? "lab" : kind === "imaging" ? "diagnostic" : null;
  const estudios = useStudies(
    catalogo ?? "lab",
    { query: value.trim() },
    catalogo !== null && value.trim().length >= 2,
  );
  const opciones = estudios.data?.rows ?? [];
  return (
    <>
      <TextField
        label={label}
        list={catalogo !== null ? listId : undefined}
        value={value}
        onChange={(e) => {
          const nombre = e.target.value;
          const elegido = opciones.find((o) => o.name === nombre);
          onChange(nombre, elegido?.id ?? "");
        }}
        maxLength={120}
        autoComplete="off"
      />
      {catalogo !== null ? (
        <datalist id={listId}>
          {opciones.map((o) => (
            <option key={o.id} value={o.name} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}

/**
 * F9-CLINIC-HC-17 — Resultados de Estudios (NOM-004 6.1.3: previos y
 * actuales). Una lista con tipo, nombre (autocompletado desde el catálogo
 * cuando es laboratorio o gabinete), fecha, resultado e interpretación.
 * PEDIR estudios vive en Órdenes médicas; aquí van los resultados.
 */
export function StudyResultsForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.studyResults.${sufijo}`);
  const timezone = useAuthStore((s) => s.user?.tenant.timezone);
  const hoy = localCalendarDate(timezone ?? "UTC", new Date());
  const [items, setItems] = useState<Resultado[]>(
    Array.isArray(initialData.items)
      ? (initialData.items as Record<string, unknown>[]).map((f) => ({
          kind: texto(f.kind) || "lab",
          name: texto(f.name),
          studyId: texto(f.studyId),
          date: texto(f.date),
          result: texto(f.result),
          interpretation: texto(f.interpretation),
        }))
      : [],
  );
  const [notes, setNotes] = useState(texto(initialData.notes));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    const lista = items
      .filter((r) => r.name.trim() !== "" && r.result.trim() !== "")
      .map((r) => ({
        kind: r.kind,
        name: r.name.trim(),
        ...(r.studyId && { studyId: r.studyId }),
        ...(r.date && { date: r.date }),
        result: r.result.trim(),
        ...(r.interpretation && { interpretation: r.interpretation }),
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
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-3">
        <legend className="font-medium text-sm">{k("list")}</legend>
        <RowList
          rows={items}
          onChange={setItems}
          emptyRow={() => ({
            kind: "lab",
            name: "",
            studyId: "",
            date: "",
            result: "",
            interpretation: "",
          })}
          addLabel={k("add")}
          label={k("list")}
          render={(row, patch) => (
            <>
              <SelectField
                label={k("kind")}
                options={STUDY_RESULT_KINDS.map((v) => ({
                  value: v,
                  label: k(`kindOptions.${v}`),
                }))}
                value={row.kind}
                onChange={(e) => patch({ kind: e.target.value, studyId: "" })}
              />
              <StudyNameField
                kind={row.kind}
                label={k("name")}
                value={row.name}
                onChange={(name, studyId) => patch({ name, studyId })}
              />
              <TextField
                label={k("date")}
                type="date"
                max={hoy}
                value={row.date}
                onChange={(e) => patch({ date: e.target.value })}
              />
              <SelectField
                label={k("interpretation")}
                options={[
                  { value: "", label: t("medicalClinic.forms.chooseOption") },
                  ...STUDY_INTERPRETATIONS.map((v) => ({
                    value: v,
                    label: k(`interpretationOptions.${v}`),
                  })),
                ]}
                value={row.interpretation}
                onChange={(e) => patch({ interpretation: e.target.value })}
              />
              <TextAreaField
                className="sm:col-span-2"
                label={k("result")}
                rows={2}
                value={row.result}
                onChange={(e) => patch({ result: e.target.value })}
                maxLength={2000}
              />
            </>
          )}
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
