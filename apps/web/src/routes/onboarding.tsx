import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { SessionLoading } from "@/components/auth/session-loading";
import { StepBusiness } from "@/components/onboarding/step-business";
import { type InviteRowResult, StepInvites } from "@/components/onboarding/step-invites";
import { StepTemplate, type TemplateChoice } from "@/components/onboarding/step-template";
import { StepWarehouse } from "@/components/onboarding/step-warehouse";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import type { ApiError } from "@/lib/api";
import { useCreateUser, useRoles } from "@/lib/rbac/hooks";
import { useUpdateMyTenant } from "@/lib/tenant/hooks";
import type { BusinessStepValues, InviteRowValues } from "@/lib/tenant/schemas";
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
  const { data: roles, isError: rolesError } = useRoles();
  const createUserMutation = useCreateUser();
  const [inviteResults, setInviteResults] = React.useState<Record<number, InviteRowResult>>({});
  const [isProcessingInvites, setIsProcessingInvites] = React.useState(false);
  // F1-WEB-ONBOARD-04: paso 4 skippable (D6, #347). "Enviar invitaciones"
  // y "Omitir" avanzan al cierre SIN marcar `tenant.onboarded` — eso es
  // F1-WEB-ONBOARD-05 (fuera de esta tarea). Por eso este flag es LOCAL y
  // efímero (no persistido, no toca `?step=`): una recarga vuelve a
  // mostrar el paso 4. El cierre real (completeOnboarding + redirect) lo
  // agrega la tarea 05 exactamente en este punto.
  const [invitesClosed, setInvitesClosed] = React.useState(false);

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

  /**
   * F1-WEB-ONBOARD-04 (D5, design A6): un `POST /users` por fila vía
   * `Promise.allSettled` — NO todo-o-nada, `POST /users` no tiene versión
   * bulk. Las filas ya exitosas (marcadas en `inviteResults`) NO se
   * reenvían al reintentar. Solo avanza al cierre si TODAS las filas
   * enviadas en este intento (nuevas + previamente exitosas) terminan en
   * éxito — una fila en error mantiene el wizard en el paso 4 para que el
   * usuario la corrija, sin bloquear a las que sí funcionaron.
   */
  async function handleInvitesSubmit(rows: InviteRowValues[]) {
    setIsProcessingInvites(true);
    const pending = rows
      .map((row, index) => ({ row, index }))
      .filter(({ index }) => inviteResults[index]?.status !== "success");

    const outcomes = await Promise.allSettled(
      pending.map(({ row }) =>
        createUserMutation.mutateAsync({
          email: row.email,
          firstName: row.firstName,
          lastNamePaternal: row.lastNamePaternal,
          roleIds: [row.roleId],
        }),
      ),
    );

    const nextResults: Record<number, InviteRowResult> = { ...inviteResults };
    outcomes.forEach((outcome, i) => {
      const pendingItem = pending[i];
      if (!pendingItem) return;
      if (outcome.status === "fulfilled") {
        nextResults[pendingItem.index] = { status: "success" };
        return;
      }
      const error = outcome.reason as ApiError;
      nextResults[pendingItem.index] = {
        status: "error",
        message: error?.statusCode === 0 ? t("common.errors.network") : error?.message,
      };
    });
    setInviteResults(nextResults);
    setIsProcessingInvites(false);

    const allSucceeded = rows.every((_, index) => nextResults[index]?.status === "success");
    if (allSucceeded) {
      setInvitesClosed(true);
    }
  }

  function handleInvitesSkip() {
    setInvitesClosed(true);
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
      {effectiveStep === 4 &&
        (invitesClosed ? (
          <p className="text-sm text-muted-foreground" data-testid="onboarding-coming-soon">
            {t("onboarding.wizard.comingSoon")}
          </p>
        ) : (
          <StepInvites
            key={effectiveStep}
            roles={roles ?? []}
            rolesUnavailable={rolesError}
            isSubmitting={isProcessingInvites}
            rowResults={inviteResults}
            onSubmit={handleInvitesSubmit}
            onSkip={handleInvitesSkip}
          />
        ))}
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
