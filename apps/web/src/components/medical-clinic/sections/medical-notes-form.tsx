import { MEDICAL_NOTE_KINDS } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RowList } from "@/components/form/row-list";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

interface Nota {
  time: string;
  kind: string;
  text: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * «HH:mm» del reloj del equipo del consultorio, no de la zona del negocio:
 * el médico está físicamente ahí y la nota se escribe en el momento. Es
 * solo la propuesta de la fila nueva; se puede corregir.
 */
function horaLocal(ahora = new Date()): string {
  return `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
}

/**
 * F9-CLINIC-DOC-02 — Notas Médicas: la línea de tiempo del día.
 *
 * Hora, tipo y texto. SIN fecha —el expediente es de un día, la de la
 * consulta— y SIN autor por nota: firma el médico del expediente y quién
 * guardó vive en `updated_by` y en la auditoría (NOM-004 5.x: fecha, hora y
 * nombre de quien elabora, los tres salen del expediente). La lista es
 * editable como las otras 21 secciones: la inmutabilidad la da el candado
 * del día siguiente, no una regla especial. La «respuesta de especialista»
 * es la nota de interconsulta o la contrarreferencia que el paciente trae
 * después: se registra el día que llega, en la consulta de ese día.
 */
export function MedicalNotesForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.medicalNotes.${sufijo}`);
  const [items, setItems] = useState<Nota[]>(
    Array.isArray(initialData.items)
      ? (initialData.items as Record<string, unknown>[]).map((f) => ({
          time: texto(f.time),
          kind: texto(f.kind) || "evolution",
          text: texto(f.text),
        }))
      : [],
  );

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    // La fila sin texto no viaja: el API solo limpia vacíos en el primer nivel.
    const lista = items
      .filter((n) => n.text.trim() !== "")
      .map((n) => ({ time: n.time, kind: n.kind, text: n.text.trim() }));
    const data: Record<string, unknown> = {};
    if (lista.length > 0) data.items = lista;
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
        <p className="text-muted-foreground text-sm">{k("hint")}</p>
        <RowList
          rows={items}
          onChange={setItems}
          max={20}
          emptyRow={() => ({ time: horaLocal(), kind: "evolution", text: "" })}
          addLabel={k("add")}
          label={k("list")}
          render={(row, patch) => (
            <>
              <TextField
                label={k("time")}
                type="time"
                value={row.time}
                onChange={(e) => patch({ time: e.target.value })}
              />
              <SelectField
                label={k("kind")}
                options={MEDICAL_NOTE_KINDS.map((v) => ({ value: v, label: k(`kinds.${v}`) }))}
                value={row.kind}
                onChange={(e) => patch({ kind: e.target.value })}
              />
              <TextAreaField
                className="sm:col-span-2"
                label={k("text")}
                rows={4}
                value={row.text}
                onChange={(e) => patch({ text: e.target.value })}
                maxLength={2000}
                placeholder={row.kind === "evolution" ? k("soapPlaceholder") : undefined}
                hint={row.kind === "specialist_reply" ? k("specialistReplyHint") : undefined}
              />
            </>
          )}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
