import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { SessionLoading } from "@/components/auth/session-loading";
import { StepBusiness } from "@/components/onboarding/step-business";
import { StepTemplate, type TemplateChoice } from "@/components/onboarding/step-template";
import { StepWarehouse } from "@/components/onboarding/step-warehouse";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import type { ApiError } from "@/lib/api";
import { useUpdateMyTenant } from "@/lib/tenant/hooks";
import type { BusinessStepValues } from "@/lib/tenant/schemas";
import { primerPasoIncompleto } from "@/lib/tenant/steps";
import { useAuthStore } from "@/stores/auth.store";

interface OnboardingSearch {
  step: 1 | 2 | 3 | 4;
}

function clampStep(value: unknown): 1 | 2 | 3 | 4 {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4) {
    return parsed as 1 | 2 | 3 | 4;
  }
  return 1;
}

export const Route = createFileRoute("/onboarding")({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    step: clampStep(search.step),
  }),
  component: OnboardingPage,
});

/**
 * A2 del design: esta ruta NO monta `OnboardingGate` — es el DESTINO del
 * redirect. Envolverla con el gate crearía el loop que el gate evita por
 * construcción (la ruta que redirige nunca puede volver a redirigirse a sí
 * misma). Sigue detrás de `ProtectedRoute` (exige sesión).
 */
function OnboardingPage() {
  return (
    <ProtectedRoute>
      <OnboardingContent />
    </ProtectedRoute>
  );
}

/**
 * A3 del design: UNA sola ruta con `?step=`, acotado a 1..4 por
 * `validateSearch`. El paso EFECTIVO nunca es el pedido a ciegas —
 * `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))` — así que
 * escribir `?step=4` a mano no salta el negocio incompleto.
 */
function OnboardingContent() {
  const { t } = useTranslation();
  const { step } = Route.useSearch();
  const navigate = useNavigate({ from: "/onboarding" });
  const tenant = useAuthStore((state) => state.user?.tenant);
  const updateTenantMutation = useUpdateMyTenant();

  // accessToken && !user (ventana de bootstrap, S6/#321): ProtectedRoute ya
  // deja pasar con solo el token — acá todavía no hay tenant del que derivar
  // nada. Mismo remedio que ProtectedRoute: loading, nunca un salto en falso.
  if (!tenant) {
    return <SessionLoading />;
  }

  const effectiveStep = Math.min(step, primerPasoIncompleto(tenant)) as 1 | 2 | 3 | 4;

  function goToStep(next: 1 | 2 | 3 | 4) {
    navigate({ search: () => ({ step: next }) });
  }

  function handleBusinessSubmit(values: BusinessStepValues) {
    updateTenantMutation.mutate(values, {
      // A4 del design: navega SOLO en onSuccess. El hook ya esperó el resync
      // (ver lib/tenant/hooks.ts) — para cuando este callback corre, el
      // tenant fresco YA está en el store.
      onSuccess: () => goToStep(2),
    });
  }

  function handleTemplateSubmit(templateChoice: TemplateChoice) {
    updateTenantMutation.mutate(
      { templateChoice },
      {
        onSuccess: () => goToStep(3),
      },
    );
  }

  // F1-WEB-ONBOARD-03 (apply-progress Deviation 6): el paso 3 no tiene
  // formulario ni datos de almacén (F2, D2) — el ÚNICO PATCH que dispara es
  // `warehouseStepSeen: true`, la señal server-side de que este paso ya se
  // recorrió. Sin ella, `primerPasoIncompleto` seguiría devolviendo 3 y
  // `effectiveStep` rebotaría al mismo paso, con o sin recarga.
  function handleWarehouseSubmit() {
    updateTenantMutation.mutate(
      { warehouseStepSeen: true },
      {
        onSuccess: () => goToStep(4),
      },
    );
  }

  return (
    <WizardShell step={effectiveStep}>
      {effectiveStep === 1 && (
        <StepBusiness
          key={effectiveStep}
          tenant={tenant}
          isSubmitting={updateTenantMutation.isPending}
          formError={
            updateTenantMutation.isError
              ? formErrorMessage(t, "onboarding.step1.error", updateTenantMutation.error)
              : undefined
          }
          onSubmit={handleBusinessSubmit}
        />
      )}
      {effectiveStep === 2 && (
        <StepTemplate
          key={effectiveStep}
          tenant={tenant}
          isSubmitting={updateTenantMutation.isPending}
          formError={
            updateTenantMutation.isError
              ? formErrorMessage(t, "onboarding.step2.error", updateTenantMutation.error)
              : undefined
          }
          onSubmit={handleTemplateSubmit}
        />
      )}
      {effectiveStep === 3 && (
        <StepWarehouse
          key={effectiveStep}
          isSubmitting={updateTenantMutation.isPending}
          formError={
            updateTenantMutation.isError
              ? formErrorMessage(t, "onboarding.step3.error", updateTenantMutation.error)
              : undefined
          }
          onSubmit={handleWarehouseSubmit}
        />
      )}
      {effectiveStep > 3 && (
        <p className="text-sm text-muted-foreground" data-testid="onboarding-coming-soon">
          {t("onboarding.wizard.comingSoon")}
        </p>
      )}
    </WizardShell>
  );
}

function formErrorMessage(
  t: (key: string) => string,
  fallbackKey: string,
  error: ApiError,
): string {
  return error.statusCode === 0 ? t("common.errors.network") : t(fallbackKey);
}
