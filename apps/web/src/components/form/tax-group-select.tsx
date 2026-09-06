import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { useTaxSettings } from "@/lib/tenant/tax-hooks";

/**
 * F4-TAX-15 — el selector «Impuesto» de los formularios de artículo.
 *
 * `""` es «el predeterminado del negocio» (viaja como `null`): es lo que casi
 * todo artículo debe llevar, y por eso la opción dice CUÁL es hoy («IVA
 * 16%»). Solo se ofrecen los grupos activos; un artículo que apunte a uno
 * desactivado lo conserva, pero el selector no lo propone a los demás.
 */
export function TaxGroupSelect({
  value,
  onChange,
  disabled,
}: {
  value: string | null;
  onChange: (taxGroupId: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { data } = useTaxSettings();
  const porDefecto = data?.groups.find((g) => g.isDefault && g.isActive);
  const activos = data?.groups.filter((g) => g.isActive) ?? [];
  const actual = data?.groups.find((g) => g.id === value);
  return (
    <SelectField
      label={t("common.tax.selectLabel")}
      value={value ?? ""}
      disabled={disabled}
      options={[
        {
          value: "",
          label:
            porDefecto === undefined
              ? t("common.tax.selectDefaultUnknown")
              : t("common.tax.selectDefault", { name: porDefecto.name }),
        },
        ...activos.map((g) => ({ value: g.id, label: g.name })),
        // El grupo desactivado que ESTE artículo ya tenía sigue apareciendo,
        // para no cambiárselo sin querer al abrir el formulario.
        ...(actual !== undefined && !actual.isActive
          ? [{ value: actual.id, label: actual.name }]
          : []),
      ]}
      onChange={(event) => onChange(event.target.value === "" ? null : event.target.value)}
    />
  );
}
