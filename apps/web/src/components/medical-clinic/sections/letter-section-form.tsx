import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RowList } from "@/components/form/row-list";
import { SectionFormActions } from "./form-actions";
import {
  emptyLetterRow,
  icd10Invalido,
  LetterItemFields,
  type LetterRow,
  type LetterVariant,
  letterRowFrom,
  letterRowToBody,
} from "./letter-item-fields";
import type { SectionFormProps } from "./registry";

/**
 * F9-CLINIC-DOC-03/04 — el formulario de cartas: una lista de referencias
 * (NOM-004 6.4) o de solicitudes de interconsulta (6.3). Mismas piezas;
 * cambia si la unidad receptora es obligatoria (en la referencia se
 * transfiere la atención: hay que decir a dónde) y las etiquetas. La fila
 * sin servicio o sin motivo no viaja; un CIE-10 mal formado o una
 * referencia sin unidad detienen el envío y lo explican en su campo.
 */
export function LetterSectionForm({
  variant,
  initialData,
  sections,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps & { variant: LetterVariant }) {
  const { t } = useTranslation();
  const kv = (sufijo: string) =>
    t(
      `medicalClinic.forms.${variant === "referral" ? "referrals" : "interconsultations"}.${sufijo}`,
    );
  const [items, setItems] = useState<LetterRow[]>(
    Array.isArray(initialData.items)
      ? (initialData.items as Record<string, unknown>[]).map(letterRowFrom)
      : [],
  );
  const [intentado, setIntentado] = useState(false);
  const exigeUnidad = variant === "referral";
  const conDatoPrincipal = (f: LetterRow) => f.service.trim() !== "" && f.reason.trim() !== "";
  const faltaUnidad = (f: LetterRow) =>
    exigeUnidad && conDatoPrincipal(f) && f.facility.trim() === "";
  const bloqueada = items.some((f) => faltaUnidad(f) || icd10Invalido(f.icd10Code));

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    setIntentado(true);
    if (bloqueada) return;
    const lista = items.filter(conDatoPrincipal).map(letterRowToBody);
    onSubmit(lista.length > 0 ? { items: lista } : {});
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <fieldset disabled={readOnly || busy} className="flex flex-col gap-3">
        <legend className="font-medium text-sm">{kv("list")}</legend>
        <p className="text-muted-foreground text-sm">{kv("hint")}</p>
        <RowList
          rows={items}
          onChange={setItems}
          max={8}
          emptyRow={emptyLetterRow}
          addLabel={kv("add")}
          label={kv("list")}
          render={(row, patch) => (
            <LetterItemFields
              variant={variant}
              row={row}
              patch={patch}
              sections={sections}
              facilityError={intentado && faltaUnidad(row) ? kv("facilityRequired") : undefined}
            />
          )}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
