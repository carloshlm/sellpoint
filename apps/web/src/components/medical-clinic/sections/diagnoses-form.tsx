import { DIAGNOSIS_CERTAINTIES, DIAGNOSIS_ROLES, ICD10_CODE } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RowList } from "@/components/form/row-list";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { SectionFormActions } from "./form-actions";
import type { SectionFormProps } from "./registry";

interface Diagnostico {
  role: string;
  description: string;
  icd10Code: string;
  certainty: string;
}

const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * F9-CLINIC-HC-18 — Diagnósticos: principal, secundarios y diferencial en
 * UNA lista. A lo más un principal (las otras filas no lo ofrecen mientras
 * exista). El código CIE-10 se escribe a mano por ahora (mayúsculas
 * automáticas, forma validada); el catálogo con buscador llega en HC-22/23.
 * Una fila sin descripción no viaja.
 */
export function DiagnosesForm({
  initialData,
  readOnly,
  busy,
  error,
  onSubmit,
  onCancel,
}: SectionFormProps) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`medicalClinic.forms.diagnoses.${sufijo}`);
  const [items, setItems] = useState<Diagnostico[]>(
    Array.isArray(initialData.items)
      ? (initialData.items as Record<string, unknown>[]).map((f) => ({
          role: texto(f.role) || "primary",
          description: texto(f.description),
          icd10Code: texto(f.icd10Code),
          certainty: texto(f.certainty),
        }))
      : [],
  );
  const hayPrincipal = (salvo: number) =>
    items.some((d, i) => i !== salvo && d.role === "primary" && d.description.trim() !== "");
  const errorCodigo = (code: string) =>
    code.trim() !== "" && !ICD10_CODE.test(code.trim()) ? k("codeInvalid") : undefined;
  const hayError = items.some((d) => errorCodigo(d.icd10Code) !== undefined);

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (hayError) return;
    const lista = items
      .filter((d) => d.description.trim() !== "")
      .map((d) => ({
        role: d.role,
        description: d.description.trim(),
        ...(d.icd10Code.trim() && { icd10Code: d.icd10Code.trim() }),
        ...(d.certainty && { certainty: d.certainty }),
      }));
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
        <legend className="font-medium text-sm">{k("list")}</legend>
        <RowList
          rows={items}
          onChange={setItems}
          emptyRow={() => ({
            role: items.some((d) => d.role === "primary") ? "secondary" : "primary",
            description: "",
            icd10Code: "",
            certainty: "",
          })}
          addLabel={k("add")}
          label={k("list")}
          render={(row, patch, index) => (
            <>
              <SelectField
                label={k("role")}
                options={DIAGNOSIS_ROLES.map((r) => ({
                  value: r,
                  label: k(`roleOptions.${r}`),
                  disabled: r === "primary" && row.role !== "primary" && hayPrincipal(index),
                }))}
                value={row.role}
                onChange={(e) => patch({ role: e.target.value })}
              />
              <TextField
                label={k("description")}
                value={row.description}
                onChange={(e) => patch({ description: e.target.value })}
                maxLength={300}
              />
              <TextField
                label={k("code")}
                hint={k("codeHint")}
                error={errorCodigo(row.icd10Code)}
                value={row.icd10Code}
                onChange={(e) => patch({ icd10Code: e.target.value.toUpperCase() })}
                maxLength={8}
                autoComplete="off"
              />
              <SelectField
                label={k("certainty")}
                options={[
                  { value: "", label: t("medicalClinic.forms.chooseOption") },
                  ...DIAGNOSIS_CERTAINTIES.map((c) => ({
                    value: c,
                    label: k(`certaintyOptions.${c}`),
                  })),
                ]}
                value={row.certainty}
                onChange={(e) => patch({ certainty: e.target.value })}
              />
            </>
          )}
        />
      </fieldset>
      <SectionFormActions readOnly={readOnly} busy={busy} onCancel={onCancel} />
    </form>
  );
}
