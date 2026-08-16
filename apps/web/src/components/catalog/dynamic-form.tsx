import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import type { CatalogField } from "@/lib/catalogs/api";
import { useLookupOptions } from "@/lib/catalogs/hooks";

interface DynamicFormProps {
  /** Campos del catálogo. Los archivados los filtra este componente. */
  fields: readonly CatalogField[];
  values: Record<string, unknown>;
  /** Errores por `key` de campo, YA traducidos. */
  errors?: Record<string, string>;
  disabled?: boolean;
  onChange: (key: string, value: unknown) => void;
}

/**
 * F2-SCHEMA-04 — renderiza los campos personalizados de CUALQUIER catálogo.
 *
 * Es el componente que hace que el motor sea un motor: el mismo form sirve al
 * alta de productos, al de registros de subcatálogos y al preview del editor
 * de campos. Nadie hardcodea un campo de ningún rubro (LEY de genericidad).
 *
 * Presentacional puro salvo por las opciones de lookup, que se piden por
 * catálogo destino: meterlas por props obligaría a cada container a saber qué
 * lookups existen antes de renderizar.
 */
function DynamicForm({ fields, values, errors, disabled, onChange }: DynamicFormProps) {
  // Los archivados no se muestran ni se piden: están ocultos, no borrados —
  // su valor sigue en `attributes` y se guarda tal cual.
  const visible = [...fields]
    .filter((field) => !field.isArchived)
    .sort((a, b) => a.position - b.position);

  return (
    <>
      {visible.map((field) => (
        <DynamicField
          key={field.id}
          field={field}
          value={values[field.key]}
          error={errors?.[field.key]}
          disabled={disabled}
          onChange={(value) => onChange(field.key, value)}
        />
      ))}
    </>
  );
}

interface DynamicFieldProps {
  field: CatalogField;
  value: unknown;
  error?: string;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}

function DynamicField({ field, value, error, disabled, onChange }: DynamicFieldProps) {
  const { t } = useTranslation();
  const label = field.required ? `${field.label} *` : field.label;

  if (field.fieldType === "lookup") {
    return (
      <LookupField
        field={field}
        label={label}
        value={typeof value === "string" ? value : ""}
        error={error}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (field.fieldType === "number") {
    return (
      <TextField
        label={label}
        type="number"
        inputMode="decimal"
        step="any"
        disabled={disabled}
        error={error}
        value={typeof value === "number" ? String(value) : ""}
        onChange={(event) => {
          // Vacío viaja como `undefined`, no como 0 ni como "": el validador
          // del server distingue "no cargado" de "cargado en cero", y un 0
          // fantasma en un campo requerido lo daría por completo.
          const raw = event.target.value;
          onChange(raw === "" ? undefined : Number(raw));
        }}
      />
    );
  }

  return (
    <TextField
      label={label}
      disabled={disabled}
      error={error}
      value={typeof value === "string" ? value : ""}
      placeholder={t("catalogs.form.textPlaceholder")}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

function LookupField({
  field,
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  field: CatalogField;
  label: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const { data: options, isPending } = useLookupOptions(field.lookupCatalogId ?? undefined);

  // El valor guardado es el ID; lo que se muestra es `código — display`, para
  // que nadie tenga que saberse los códigos de memoria.
  const choices = (options ?? []).map((option) => ({
    value: option.id,
    label: option.code === option.display ? option.code : `${option.code} — ${option.display}`,
  }));

  return (
    <SelectField
      label={label}
      disabled={disabled || isPending}
      error={error}
      value={value}
      options={[{ value: "", label: t("catalogs.form.lookupPlaceholder") }, ...choices]}
      hint={!isPending && choices.length === 0 ? t("catalogs.form.lookupEmpty") : undefined}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}

export { DynamicForm };
