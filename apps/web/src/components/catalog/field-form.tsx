import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { CatalogField, CatalogSummary, FieldType } from "@/lib/catalogs/api";

export interface FieldFormValues {
  label: string;
  fieldType: FieldType;
  lookupCatalogId: string;
  required: boolean;
}

interface FieldFormProps {
  /** Presente → edición. El tipo queda bloqueado si el campo tiene datos. */
  field?: CatalogField;
  catalogs: readonly CatalogSummary[];
  currentCatalogId: string;
  /** El API rechaza cambiar el tipo con datos; la UI lo anticipa. */
  typeLocked?: boolean;
  isSubmitting: boolean;
  error?: string | null;
  onSubmit: (values: FieldFormValues) => void;
  onCancel: () => void;
}

/**
 * F2-SCHEMA-02/03. El usuario escribe la ETIQUETA; la `key` la deriva el
 * server y no se muestra ni se edita — es lo que permite renombrar un campo
 * sin mover un solo dato.
 */
function FieldForm({
  field,
  catalogs,
  currentCatalogId,
  typeLocked,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: FieldFormProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<FieldFormValues>({
    label: field?.label ?? "",
    fieldType: field?.fieldType ?? "text",
    lookupCatalogId: field?.lookupCatalogId ?? "",
    required: field?.required ?? false,
  });

  const set = <K extends keyof FieldFormValues>(key: K, value: FieldFormValues[K]) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  // Un lookup no puede apuntar al catálogo que se está editando: sería una
  // referencia circular sin contenido posible.
  const lookupTargets = catalogs
    .filter((catalog) => catalog.isActive && catalog.id !== currentCatalogId)
    .map((catalog) => ({ value: catalog.id, label: catalog.name }));

  const canSubmit =
    values.label.trim().length > 0 &&
    (values.fieldType !== "lookup" || values.lookupCatalogId.length > 0);

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          onSubmit(values);
        }
      }}
    >
      {error && (
        <p
          role="alert"
          data-testid="field-form-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <TextField
        label={t("catalogs.fields.form.label")}
        value={values.label}
        hint={t("catalogs.fields.form.labelHint")}
        onChange={(event) => set("label", event.target.value)}
      />

      <SelectField
        label={t("catalogs.fields.form.type")}
        value={values.fieldType}
        disabled={typeLocked}
        hint={typeLocked ? t("catalogs.fields.form.typeLocked") : undefined}
        options={[
          { value: "text", label: t("catalogs.fields.types.text") },
          { value: "number", label: t("catalogs.fields.types.number") },
          { value: "lookup", label: t("catalogs.fields.types.lookup") },
        ]}
        onChange={(event) => set("fieldType", event.target.value as FieldType)}
      />

      {values.fieldType === "lookup" && (
        <SelectField
          label={t("catalogs.fields.form.lookupTarget")}
          value={values.lookupCatalogId}
          options={[
            { value: "", label: t("catalogs.fields.form.lookupTargetPlaceholder") },
            ...lookupTargets,
          ]}
          hint={
            lookupTargets.length === 0 ? t("catalogs.fields.form.lookupTargetEmpty") : undefined
          }
          onChange={(event) => set("lookupCatalogId", event.target.value)}
        />
      )}

      <div className="flex items-center gap-2">
        <Checkbox
          id="field-required"
          checked={values.required}
          onCheckedChange={(checked) => set("required", checked === true)}
        />
        <Label htmlFor="field-required">{t("catalogs.fields.form.required")}</Label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting || !canSubmit}>
          {isSubmitting ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}

export { FieldForm };
