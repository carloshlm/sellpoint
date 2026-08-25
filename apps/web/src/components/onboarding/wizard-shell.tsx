import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WizardShellProps {
  step: 1 | 2 | 3;
  children: React.ReactNode;
}

/**
 * F1-WEB-ONBOARD-01. Shell presentacional del wizard: título + indicador de
 * paso ("Paso N de 4") + el paso activo. No conoce steps.ts ni el tenant —
 * el container (`routes/onboarding.tsx`) decide QUÉ paso mostrar.
 */
function WizardShell({ step, children }: WizardShellProps) {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <p className="text-sm text-muted-foreground" data-testid="wizard-step-label">
            {t("onboarding.wizard.stepLabel", { step })}
          </p>
          <CardTitle>{t("onboarding.wizard.title")}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

export { WizardShell };
