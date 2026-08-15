import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { TenantBlock } from "@/lib/tenant/api";
import { cn } from "@/lib/utils";

/**
 * F1-WEB-ONBOARD-02, paso 2 (CU-AUTH-02). Las 4 plantillas del tablero —
 * spec (Capability tenant-onboarding, Requirement "Paso 2 — placeholder de
 * plantilla") pide SOLO "elegir y persistir", sin editor real (D2, #347).
 * El flujo alternativo 2a de CU-AUTH-02 ("Personalizado" → editor de
 * schema) queda fuera de F1: acá "Personalizado" persiste su elección
 * exactamente igual que las demás — el editor real es de F2.
 */
export const TEMPLATE_CHOICES = ["pharmacy", "hardware", "grocery", "custom"] as const;
export type TemplateChoice = (typeof TEMPLATE_CHOICES)[number];

function isTemplateChoice(value: string | null): value is TemplateChoice {
  return (TEMPLATE_CHOICES as readonly string[]).includes(value ?? "");
}

interface StepTemplateProps {
  tenant: TenantBlock;
  isSubmitting: boolean;
  formError?: string | null;
  onSubmit: (templateChoice: TemplateChoice) => void;
}

/**
 * A4 del design: el container le pasa `key={effectiveStep}` para forzar un
 * remount limpio; acá la selección arranca sembrada desde `tenant.templateChoice`
 * (nunca de un draft en memoria), igual que `step-business.tsx`.
 */
function StepTemplate({ tenant, isSubmitting, formError, onSubmit }: StepTemplateProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = React.useState<TemplateChoice | null>(
    isTemplateChoice(tenant.templateChoice) ? tenant.templateChoice : null,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) {
      return;
    }
    onSubmit(selected);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("onboarding.step2.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("onboarding.step2.subtitle")}</p>
      </div>
      {formError && (
        <p
          role="alert"
          data-testid="step-template-error"
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {formError}
        </p>
      )}
      <RadioGroup
        value={selected ?? undefined}
        onValueChange={(value) => setSelected(value as TemplateChoice)}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        {TEMPLATE_CHOICES.map((choice) => (
          <RadioGroupItem
            key={choice}
            value={choice}
            aria-label={t(`onboarding.step2.templates.${choice}.name`)}
            data-testid={`template-card-${choice}`}
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors",
              "data-[state=checked]:border-primary data-[state=checked]:bg-primary/5",
              "data-[state=unchecked]:border-border data-[state=unchecked]:bg-background data-[state=unchecked]:hover:bg-muted",
            )}
          >
            <span className="font-medium">{t(`onboarding.step2.templates.${choice}.name`)}</span>
            <span className="text-sm text-muted-foreground">
              {t(`onboarding.step2.templates.${choice}.description`)}
            </span>
          </RadioGroupItem>
        ))}
      </RadioGroup>
      <div>
        <Button type="submit" disabled={isSubmitting || !selected}>
          {isSubmitting ? t("common.form.submitting") : t("onboarding.step2.continue")}
        </Button>
      </div>
    </form>
  );
}

export { StepTemplate };
