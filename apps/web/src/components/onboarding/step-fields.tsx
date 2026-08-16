import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import type { FieldType } from "@/lib/catalogs/api";
import { useCatalogFields, useCatalogs, useCreateField } from "@/lib/catalogs/hooks";

interface StepFieldsProps {
  isSubmitting: boolean;
  formError?: string | null;
  onSubmit: () => void;
}

/**
 * F2-ONBOARD-01/02 — paso 2 del wizard.
 *
 * Reemplaza al selector de plantillas por rubro (farmacia / ferretería /
 * abarrotes) por la LEY DE GENERICIDAD (Carlos, 2026-08-16): SellPoint no
 * trae campos definidos para ningún giro. El negocio nombra los suyos.
 *
 * Las plantillas sugeridas por rubro (Layouts) son una funcionalidad
 * posterior y opcional — Fase 9.0 del tablero. Cuando lleguen, van a crear
 * `catalog_fields` normales, indistinguibles de los que el tenant hubiera
 * escrito a mano.
 *
 * "Definir después" es un camino de primera clase, no un escape: el negocio
 * puede empezar a cargar productos con los campos estándar y sumar los suyos
 * cuando sepa cuáles necesita.
 */
function StepFields({ isSubmitting, formError, onSubmit }: StepFieldsProps) {
  const { t } = useTranslation();
  const { data: catalogs } = useCatalogs();
  const productsCatalog = catalogs?.find((catalog) => catalog.isSystem);
  const { data: fields } = useCatalogFields(productsCatalog?.id);
  const createField = useCreateField(productsCatalog?.id ?? "");

  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [error, setError] = useState<string | null>(null);

  const custom = (fields ?? []).filter((field) => !field.isArchived);

  return (
    <div className="flex flex-col gap-4" data-testid="step-fields">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step2.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step2.subtitle")}</p>
      </div>

      {(formError || error) && (
        <p
          role="alert"
          data-testid="step-fields-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError ?? error}
        </p>
      )}

      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          {t("onboarding.step2.standardTitle")}
        </p>
        <ul className="flex flex-wrap gap-2">
          {["code", "name", "price", "cost", "baseUnit"].map((key) => (
            <li key={key}>
              <Badge variant="default">{t(`catalogs.standard.${key}`)}</Badge>
            </li>
          ))}
        </ul>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          createField.mutate(
            { label, fieldType, required: false },
            {
              onSuccess: () => setLabel(""),
              onError: (apiError: ApiError) => setError(apiError.message),
            },
          );
        }}
      >
        <TextField
          label={t("onboarding.step2.fieldLabel")}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
        <SelectField
          label={t("onboarding.step2.fieldType")}
          value={fieldType}
          options={[
            { value: "text", label: t("catalogs.fields.types.text") },
            { value: "number", label: t("catalogs.fields.types.number") },
          ]}
          onChange={(event) => setFieldType(event.target.value as FieldType)}
        />
        <Button type="submit" disabled={!label.trim() || createField.isPending}>
          {t("common.form.add")}
        </Button>
      </form>

      {custom.length > 0 && (
        <ul className="flex flex-wrap gap-2" data-testid="step-fields-added">
          {custom.map((field) => (
            <li key={field.id}>
              <Badge variant="success">{field.label}</Badge>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">{t("onboarding.step2.laterHint")}</p>

      <div className="flex gap-2">
        <Button type="button" disabled={isSubmitting} onClick={onSubmit}>
          {isSubmitting ? t("common.form.submitting") : t("onboarding.step2.continue")}
        </Button>
      </div>
    </div>
  );
}

export { StepFields };
