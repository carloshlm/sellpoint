import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RowList } from "@/components/form/row-list";
import { Button } from "@/components/ui/button";
import { SuccessNotice } from "@/components/ui/success-notice";
import { printSectionLetter } from "@/lib/medical-clinic/api";
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
 * F9-CLINIC-DOC-03/04/06 — el formulario de cartas: una lista de referencias
 * (NOM-004 6.4) o de solicitudes de interconsulta (6.3). Mismas piezas;
 * cambia si la unidad receptora es obligatoria (en la referencia se
 * transfiere la atención: hay que decir a dónde) y las etiquetas. La fila
 * sin servicio o sin motivo no viaja; un CIE-10 mal formado o una
 * referencia sin unidad detienen el envío y lo explican en su campo.
 *
 * Al guardar, la ruta se QUEDA aquí (`KEEP_OPEN_SECTIONS`) y aparece un
 * «Imprimir» por carta persistida: el paciente se la lleva en la mano. Se
 * imprime por índice, así que solo se ofrece lo que ya está guardado.
 */
export function LetterSectionForm({
  variant,
  recordId,
  folio,
  initialData,
  sections,
  readOnly,
  busy,
  saved,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps & { variant: LetterVariant }) {
  const { t } = useTranslation();
  const seccion = variant === "referral" ? "referrals" : "interconsultations";
  const kv = (sufijo: string, args?: Record<string, unknown>) =>
    t(`medicalClinic.forms.${seccion}.${sufijo}`, args);
  const [items, setItems] = useState<LetterRow[]>(
    Array.isArray(initialData.items)
      ? (initialData.items as Record<string, unknown>[]).map(letterRowFrom)
      : [],
  );
  const [intentado, setIntentado] = useState(false);
  const [errorImpresion, setErrorImpresion] = useState(false);
  const exigeUnidad = variant === "referral";
  const conDatoPrincipal = (f: LetterRow) => f.service.trim() !== "" && f.reason.trim() !== "";
  const faltaUnidad = (f: LetterRow) =>
    exigeUnidad && conDatoPrincipal(f) && f.facility.trim() === "";
  const bloqueada = items.some((f) => faltaUnidad(f) || icd10Invalido(f.icd10Code));
  // Solo lo persistido se imprime: el índice es el de la sección guardada.
  const persistidas = Array.isArray(initialData.items) ? initialData.items.length : 0;
  const serie = variant === "referral" ? "REF" : "INT";

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    setIntentado(true);
    if (bloqueada) return;
    const lista = items.filter(conDatoPrincipal).map(letterRowToBody);
    onSubmit(lista.length > 0 ? { items: lista } : {});
  };

  const imprimir = (index: number) => {
    setErrorImpresion(false);
    printSectionLetter(recordId, seccion, index, `${folio}-${serie}-${index + 1}.pdf`).catch(() =>
      setErrorImpresion(true),
    );
  };

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4" aria-busy={busy}>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {saved ? (
        <div className="flex flex-col gap-3" data-testid="letter-saved">
          <SuccessNotice>{t("medicalClinic.forms.letter.saved")}</SuccessNotice>
          {errorImpresion ? (
            <p role="alert" className="text-destructive text-sm">
              {t("medicalClinic.orders.printFailed")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: persistidas }, (_, index) => (
              <Button
                // El índice ES la identidad de la carta en su sección.
                // biome-ignore lint/suspicious/noArrayIndexKey: cartas sin id propio
                key={index}
                type="button"
                onClick={() => imprimir(index)}
              >
                {kv("print", { number: index + 1 })}
              </Button>
            ))}
            <Button asChild variant="outline">
              <Link to="/medical-clinic/records/$recordId" params={{ recordId }}>
                {t("medicalClinic.orders.backToRecord")}
              </Link>
            </Button>
          </div>
        </div>
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
