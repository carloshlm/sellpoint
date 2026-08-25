import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ThemePicker } from "@/components/theme/theme-picker";
import { Button } from "@/components/ui/button";
import { applyTheme } from "@/lib/theme/apply-theme";
import type { ThemeId } from "@/lib/theme/themes";

/**
 * Paso 3 del wizard (Carlos, 2026-08-25): el TEMA inicial del negocio.
 *
 * La elección se APLICA AL MOMENTO (Carlos, 2026-08-26): el clic en una
 * muestra re-pinta el wizard entero con ese tema — un tema se elige viendo,
 * no imaginando. Si el usuario recarga sin Terminar, el bootstrap vuelve al
 * tema real del tenant: la vista previa nunca persiste sola.
 *
 * `light` preseleccionado: es el aspecto que el usuario YA está viendo, así
 * que Terminar sin tocar nada es una elección coherente, no una omisión.
 */
export type ThemeChoice = ThemeId;

interface StepThemeProps {
  isSubmitting: boolean;
  formError?: string;
  onSubmit: (theme: ThemeChoice) => void;
}

function StepTheme({ isSubmitting, formError, onSubmit }: StepThemeProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<ThemeChoice>("light");

  function preview(theme: ThemeChoice) {
    setSelected(theme);
    // La vista previa en vivo: el documento entero cambia con el clic.
    applyTheme(theme);
    // La vista previa en vivo: el documento entero cambia con el clic.
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-semibold text-lg">{t("onboarding.step3.title")}</h2>
        <p className="text-muted-foreground text-sm">{t("onboarding.step3.subtitle")}</p>
      </div>

      {formError && (
        <p
          role="alert"
          data-testid="step-theme-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
        >
          {formError}
        </p>
      )}

      <ThemePicker value={selected} onChange={preview} disabled={isSubmitting} />

      <p className="text-muted-foreground text-xs">{t("onboarding.step3.changeLaterHint")}</p>

      <Button type="button" disabled={isSubmitting} onClick={() => onSubmit(selected)}>
        {isSubmitting ? t("common.form.submitting") : t("onboarding.step3.finish")}
      </Button>
    </div>
  );
}

export { StepTheme };
