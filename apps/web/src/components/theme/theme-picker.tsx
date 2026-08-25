import { useTranslation } from "react-i18next";
import { THEME_LIST, type ThemeId } from "@/lib/theme/themes";
import { cn } from "@/lib/utils";

/**
 * El selector de temas — UNA pieza para sus dos casas (el paso 3 del wizard
 * y Mi perfil), para que elegir tema se vea y se opere igual en ambas.
 *
 * Radios NATIVOS (sr-only) dentro del label: teclado, lectores y formularios
 * los entienden gratis. La opción elegida se marca con el anillo del token
 * primary, no solo con color — el color ES la opción, no puede ser también
 * el indicador. Las muestras salen del catálogo (`THEMES.swatch`): hex fijos
 * a propósito, son la vista previa del selector, no los tokens del tema.
 */
interface ThemePickerProps {
  value: ThemeId;
  onChange: (theme: ThemeId) => void;
  disabled?: boolean;
  /** Distingue los grupos cuando hubiera dos pickers montados (no hoy). */
  name?: string;
}

function ThemePicker({ value, onChange, disabled = false, name = "theme" }: ThemePickerProps) {
  const { t } = useTranslation();

  return (
    <fieldset className="grid grid-cols-2 gap-3 border-0 p-0 sm:grid-cols-4" disabled={disabled}>
      <legend className="sr-only">{t("common.theme.label")}</legend>
      {THEME_LIST.map((theme) => (
        <label
          key={theme.id}
          data-testid={`theme-${theme.id}`}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-border p-3 transition-all",
            value === theme.id && "border-primary ring-2 ring-primary/50",
            disabled && "cursor-default opacity-60",
          )}
        >
          <input
            type="radio"
            name={name}
            value={theme.id}
            checked={value === theme.id}
            onChange={() => onChange(theme.id)}
            className="sr-only"
          />
          <span
            aria-hidden="true"
            className="h-14 w-full rounded-md border border-border"
            style={{ backgroundColor: theme.swatch }}
          />
          <span className="font-medium text-sm">{t(theme.nameKey)}</span>
        </label>
      ))}
    </fieldset>
  );
}

export { ThemePicker };
