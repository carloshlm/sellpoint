import { ICD10_CODE, LETTER_PRIORITIES } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { Icd10Picker } from "@/components/medical-clinic/icd10-picker";
import { Button } from "@/components/ui/button";
import type { RecordSection } from "@/lib/medical-clinic/api";
import { letterPrefill } from "@/lib/medical-clinic/letter-prefill";

export type LetterVariant = "referral" | "interconsultation";

/** Una carta en pantalla: todo texto, lo vacío se omite al enviar. */
export interface LetterRow {
  priority: string;
  facility: string;
  service: string;
  doctorName: string;
  reason: string;
  clinicalSummary: string;
  diagnosis: string;
  icd10Code: string;
  treatment: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

export const emptyLetterRow = (): LetterRow => ({
  priority: "routine",
  facility: "",
  service: "",
  doctorName: "",
  reason: "",
  clinicalSummary: "",
  diagnosis: "",
  icd10Code: "",
  treatment: "",
});

export const letterRowFrom = (f: Record<string, unknown>): LetterRow => ({
  priority: texto(f.priority) || "routine",
  facility: texto(f.facility),
  service: texto(f.service),
  doctorName: texto(f.doctorName),
  reason: texto(f.reason),
  clinicalSummary: texto(f.clinicalSummary),
  diagnosis: texto(f.diagnosis),
  icd10Code: texto(f.icd10Code),
  treatment: texto(f.treatment),
});

/** Lo que viaja: solo lo capturado (el API limpia vacíos solo en el primer nivel). */
export function letterRowToBody(f: LetterRow): Record<string, unknown> {
  const opcional = (clave: keyof LetterRow) =>
    f[clave].trim() === "" ? {} : { [clave]: f[clave].trim() };
  return {
    priority: f.priority,
    ...opcional("facility"),
    service: f.service.trim(),
    ...opcional("doctorName"),
    reason: f.reason.trim(),
    ...opcional("clinicalSummary"),
    ...opcional("diagnosis"),
    ...opcional("icd10Code"),
    ...opcional("treatment"),
  };
}

export const icd10Invalido = (code: string): boolean =>
  code.trim() !== "" && !ICD10_CODE.test(code.trim());

/**
 * F9-CLINIC-DOC-03 — los campos de UNA carta, comunes a la referencia
 * (NOM-004 6.4) y a la solicitud de interconsulta (6.3): prioridad, a quién
 * va, por qué, el resumen clínico, la impresión diagnóstica con su CIE-10 y
 * la terapéutica empleada. Las etiquetas cambian por variante; la forma no.
 * «Traer del expediente» llena SOLO lo vacío con lo ya capturado: nunca
 * pisa lo que el médico escribió.
 */
export function LetterItemFields({
  variant,
  row,
  patch,
  sections,
  facilityError,
}: {
  variant: LetterVariant;
  row: LetterRow;
  patch: (changes: Partial<LetterRow>) => void;
  sections: readonly RecordSection[];
  facilityError?: string;
}) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.letter.${sufijo}`);
  const kv = (sufijo: string) =>
    t(
      `medicalClinic.forms.${variant === "referral" ? "referrals" : "interconsultations"}.${sufijo}`,
    );

  const traer = () => {
    const p = letterPrefill(sections);
    patch({
      ...(row.clinicalSummary.trim() === "" &&
        p.clinicalSummary !== null && { clinicalSummary: p.clinicalSummary }),
      ...(row.diagnosis.trim() === "" && p.diagnosis !== null && { diagnosis: p.diagnosis }),
      ...(row.icd10Code.trim() === "" && p.icd10Code !== null && { icd10Code: p.icd10Code }),
      ...(row.treatment.trim() === "" && p.treatment !== null && { treatment: p.treatment }),
    });
  };

  return (
    <>
      <SelectField
        label={k("priority")}
        options={LETTER_PRIORITIES.map((p) => ({ value: p, label: k(`priorityOptions.${p}`) }))}
        value={row.priority}
        onChange={(e) => patch({ priority: e.target.value })}
      />
      <TextField
        label={kv("facility")}
        value={row.facility}
        onChange={(e) => patch({ facility: e.target.value })}
        maxLength={160}
        error={facilityError}
        hint={variant === "referral" ? kv("facilityHint") : undefined}
      />
      <TextField
        label={kv("service")}
        value={row.service}
        onChange={(e) => patch({ service: e.target.value })}
        maxLength={120}
      />
      <TextField
        label={kv("doctorName")}
        value={row.doctorName}
        onChange={(e) => patch({ doctorName: e.target.value })}
        maxLength={120}
      />
      <TextAreaField
        className="sm:col-span-2"
        label={kv("reason")}
        rows={3}
        value={row.reason}
        onChange={(e) => patch({ reason: e.target.value })}
        maxLength={1000}
        placeholder={kv("reasonPlaceholder")}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
        <span className="text-muted-foreground text-xs">{k("prefillHint")}</span>
        <Button type="button" variant="outline" className="w-fit" onClick={traer}>
          {k("prefill")}
        </Button>
      </div>
      <TextAreaField
        className="sm:col-span-2"
        label={k("clinicalSummary")}
        rows={5}
        value={row.clinicalSummary}
        onChange={(e) => patch({ clinicalSummary: e.target.value })}
        maxLength={4000}
      />
      <TextField
        label={k("diagnosis")}
        value={row.diagnosis}
        onChange={(e) => patch({ diagnosis: e.target.value })}
        maxLength={500}
      />
      <TextField
        label={k("icd10Code")}
        hint={t("medicalClinic.forms.diagnoses.codeHint")}
        error={
          icd10Invalido(row.icd10Code) ? t("medicalClinic.forms.diagnoses.codeInvalid") : undefined
        }
        value={row.icd10Code}
        onChange={(e) => patch({ icd10Code: e.target.value.toUpperCase() })}
        maxLength={8}
        autoComplete="off"
      />
      <Icd10Picker
        label={k("search")}
        onPick={(hit) =>
          patch({
            icd10Code: hit.code,
            // La impresión escrita a mano no se pisa: el catálogo solo llena lo vacío.
            ...(row.diagnosis.trim() === "" && { diagnosis: hit.title }),
          })
        }
      />
      <TextAreaField
        className="sm:col-span-2"
        label={k("treatment")}
        rows={3}
        value={row.treatment}
        onChange={(e) => patch({ treatment: e.target.value })}
        maxLength={2000}
      />
    </>
  );
}
