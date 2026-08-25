import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Paso 3 del wizard (Carlos, 2026-08-25): el TEMA inicial del negocio.
 *
 * Cuatro opciones cerradas — light, dark, sand, grape — pintadas como
 * muestras de color grandes y clickeables (un tema se ELIGE viendo, no
 * leyendo). Los identificadores viajan en inglés (LEY); los nombres
 * visibles salen de i18n.
 *
 * Las MUESTRAS son hex fijos a propósito y solo viven acá: son la vista
 * previa del selector, no los estilos del tema — esos llegan después
 * (Carlos los definirá) y vivirán como tokens en index.css. Por eso elegir
 * un tema hoy solo GUARDA la preferencia, sin re-pintar nada.
 *
 * Accesibilidad: radiogroup real — cada muestra es un botón con
 * role="radio" y aria-checked; la seleccionada se marca con el anillo del
 * token primary, no solo con color (el color ES la opción, no puede ser
 * también el indicador).
 */
export type ThemeChoice = "light" | "dark" | "sand" | "grape";

const THEME_SWATCHES: Record<ThemeChoice, string> = {
  light: "#ffffff",
  dark: "#16181d",
  // Los tonos de Carlos (capturas 2026-08-25).
  grape: "#5d5468",
  sand: "#b57f55",
};

const THEME_ORDER: ThemeChoice[] = ["light", "dark", "sand", "grape"];

interface StepThemeProps {
  isSubmitting: boolean;
  formError?: string;
  onSubmit: (theme: ThemeChoice) => void;
}

function StepTheme({ isSubmitting, formError, onSubmit }: StepThemeProps) {
  const { t } = useTranslation();
  // `light` preseleccionado: es el aspecto que el usuario YA está viendo, así
  // que Terminar sin tocar nada es una elección coherente, no una omisión.
  const [selected, setSelected] = useState<ThemeChoice>("light");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step3.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step3.subtitle")}</p>
      </div>

      {formError && (
        <p
          role="alert"
          data-testid="step-theme-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      )}

      {/* Radios NATIVOS (sr-only) dentro del label: teclado, lectores y
          formularios los entienden gratis — un botón con role="radio" solo
          los imita (lo señaló biome useSemanticElements). */}
      <fieldset className="grid grid-cols-2 gap-3 border-0 p-0 sm:grid-cols-4">
        <legend className="sr-only">{t("onboarding.step3.title")}</legend>
        {THEME_ORDER.map((theme) => (
          <label
            key={theme}
            data-testid={`theme-${theme}`}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-border p-3 transition-all",
              selected === theme && "border-primary ring-2 ring-primary/50",
            )}
          >
            <input
              type="radio"
              name="theme"
              value={theme}
              checked={selected === theme}
              onChange={() => setSelected(theme)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className="h-14 w-full rounded-md border border-border"
              style={{ backgroundColor: THEME_SWATCHES[theme] }}
            />
            <span className="text-sm font-medium">{t(`onboarding.step3.themes.${theme}`)}</span>
          </label>
        ))}
      </fieldset>

      <p className="text-xs text-muted-foreground">{t("onboarding.step3.changeLaterHint")}</p>

      <Button type="button" disabled={isSubmitting} onClick={() => onSubmit(selected)}>
        {isSubmitting ? t("common.form.submitting") : t("onboarding.step3.finish")}
      </Button>
    </div>
  );
}

export { StepTheme };
