import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { SessionLoading } from "@/components/auth/session-loading";
import { StepBusiness } from "@/components/onboarding/step-business";
import { StepFields } from "@/components/onboarding/step-fields";
import { type InviteRowResult, StepInvites } from "@/components/onboarding/step-invites";
import { StepWarehouse } from "@/components/onboarding/step-warehouse";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import type { ApiError } from "@/lib/api";
import { useCreateUser, useRoles } from "@/lib/rbac/hooks";
import { useCompleteOnboarding, useUpdateMyTenant } from "@/lib/tenant/hooks";
import type { BusinessStepValues, InviteRowValues } from "@/lib/tenant/schemas";
import { primerPasoIncompleto } from "@/lib/tenant/steps";
import { useWarehouses } from "@/lib/warehouses/hooks";
import { useAuthStore } from "@/stores/auth.store";

interface OnboardingSearch {
  // W1 (verify-report #357): `step` es OPCIONAL — ausente (entrada desde el
  // gate, o `/onboarding` a secas) YA NO equivale a "pedí el paso 1". Ver
  // `effectiveStep` en `OnboardingContent`: sin `step`, el paso por defecto
  // es el DERIVADO del tenant (`primerPasoIncompleto`), no un fijo en 1.
  step?: 1 | 2 | 3 | 4;
}

function clampStep(value: unknown): 1 | 2 | 3 | 4 | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 4) {
    return parsed as 1 | 2 | 3 | 4;
  }
  return undefined;
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
      <OnboardingGateway />
    </ProtectedRoute>
  );
}

/**
 * C1 (verify-report #357): `ProtectedRoute` sola solo exige sesión, no
 * permiso — cualquier usuario autenticado (Manager/Viewer de un tenant a
 * medio configurar) podía escribir la URL y entrar al wizard entero, donde
 * TODO botón termina en 403 sin mensaje útil (el backend SÍ gatea el PATCH,
 * pero la ruta no lo evitaba). `PermissionGate` (mismo componente que
 * `system.users.tsx`) corta acá con un panel explicando el motivo — nunca un
 * redirect silencioso que esconda por qué el usuario rebotó (D2 del design).
 *
 * El chequeo `!tenant` (ventana de bootstrap, S6/#321: `accessToken && !user`
 * — `ProtectedRoute` ya deja pasar con solo el token) va ANTES del
 * `PermissionGate`: `usePermissions()` lee `user.permissions` del store, y
 * sin `user` todavía `has()` devuelve `false` — meter el gate primero
 * mostraría "Sin permiso" por un instante mientras el bootstrap resuelve,
 * un falso negativo en vez de loading.
 */
function OnboardingGateway() {
  const tenant = useAuthStore((state) => state.user?.tenant);

  if (!tenant) {
    return <SessionLoading />;
  }

  return (
    <PermissionGate need="tenants:manage">
      <OnboardingContent />
    </PermissionGate>
  );
}

/**
 * A3 del design: UNA sola ruta con `?step=`, acotado a 1..4 por
 * `validateSearch`. El paso EFECTIVO nunca es el pedido a ciegas —
 * `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))` — así que
 * escribir `?step=4` a mano no salta el negocio incompleto.
 *
 * `tenant` ya está garantizado no-nulo acá — lo resolvió `OnboardingGateway`.
 */
function OnboardingContent() {
  const { t } = useTranslation();
  const { step } = Route.useSearch();
  const navigate = useNavigate({ from: "/onboarding" });
  const tenant = useAuthStore((state) => state.user?.tenant);
  const updateTenantMutation = useUpdateMyTenant();
  const completeOnboardingMutation = useCompleteOnboarding();
  const { data: roles, isError: rolesError } = useRoles();
  const createUserMutation = useCreateUser();
  // W3 (verify-report #357): por `field.id` de `useFieldArray`, NUNCA por
  // posición del array — ver `components/onboarding/step-invites.tsx`.
  const [inviteResults, setInviteResults] = React.useState<Record<string, InviteRowResult>>({});
  const [isProcessingInvites, setIsProcessingInvites] = React.useState(false);
  // F2-ONBOARD-03: el piso del paso 3 depende de si ya existe un almacén.
  // Va ACÁ, antes de cualquier return temprano: un hook después de un `if`
  // que retorna rompe el orden de hooks entre renders (lo detectó el test de
  // la ruta con "Rendered fewer hooks than expected").
  const { data: warehouses } = useWarehouses();

  if (!tenant) {
    return <SessionLoading />;
  }

  // Requirement transversal "Gate de redirect por estado de onboarding"
  // (spec #348): un tenant YA onboarded que llega a /onboarding (a mano, un
  // link viejo, o el botón atrás del navegador tras terminar el wizard)
  // nunca vuelve a ver el wizard — se lo manda a /dashboard. `OnboardingGate`
  // (A2) no cubre este caso porque, a propósito, NO se monta en esta ruta.
  if (tenant.onboarded) {
    return <Navigate to="/dashboard" replace />;
  }

  // W1 (verify-report #357): sin `step` en la URL (entrada desde el gate, o
  // `/onboarding` a secas), el paso por defecto es el PISO derivado del
  // tenant — no 1. Con `step` presente, sigue sin poder saltar el negocio
  // incompleto (`min`).
  const piso = primerPasoIncompleto(tenant, {
    // `undefined` mientras carga: no se baja el piso a 3 con datos a medias,
    // que haría parpadear el wizard.
    hasWarehouse: warehouses === undefined ? undefined : warehouses.length > 0,
  });
  const effectiveStep = (step === undefined ? piso : Math.min(step, piso)) as 1 | 2 | 3 | 4;

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

  function handleFieldsSubmit() {
    // `templateChoice` sigue marcando "pasó por el paso 2". Ya no nombra un
    // rubro: se escribe un valor neutro (LEY de genericidad — los Layouts por
    // rubro son Fase 9.0).
    const templateChoice = "custom";
    updateTenantMutation.mutate(
      { templateChoice },
      {
        onSuccess: () => goToStep(3),
      },
    );
  }

  // W4 (verify-report #357, revierte Deviation 6): el paso 3 no tiene
  // formulario ni datos de almacén (F2, D2) y NO dispara ningún PATCH — el
  // requirement original ("avanza al paso 4 sin llamada de escritura
  // adicional", spec #348) se cumple derivando el piso puro
  // (`primerPasoIncompleto`, lib/tenant/steps.ts): con negocio y plantilla
  // completos el piso YA es 4, así que `goToStep(4)` alcanza solo.
  function handleWarehouseSubmit() {
    goToStep(4);
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
  async function handleInvitesSubmit(rows: (InviteRowValues & { id: string })[]) {
    setIsProcessingInvites(true);
    // W3: filtra por `row.id` (field.id), no por índice — una fila ya
    // exitosa NO se reenvía sin importar en qué posición quedó tras un
    // remove().
    const pending = rows.filter((row) => inviteResults[row.id]?.status !== "success");

    const outcomes = await Promise.allSettled(
      pending.map((row) =>
        createUserMutation.mutateAsync({
          email: row.email,
          firstName: row.firstName,
          lastNamePaternal: row.lastNamePaternal,
          roleIds: [row.roleId],
        }),
      ),
    );

    const nextResults: Record<string, InviteRowResult> = { ...inviteResults };
    outcomes.forEach((outcome, i) => {
      const pendingItem = pending[i];
      if (!pendingItem) return;
      if (outcome.status === "fulfilled") {
        nextResults[pendingItem.id] = { status: "success" };
        return;
      }
      const error = outcome.reason as ApiError;
      nextResults[pendingItem.id] = {
        status: "error",
        message: error?.statusCode === 0 ? t("common.errors.network") : error?.message,
      };
    });
    setInviteResults(nextResults);
    setIsProcessingInvites(false);

    const allSucceeded = rows.every((row) => nextResults[row.id]?.status === "success");
    if (allSucceeded) {
      finishOnboarding();
    }
  }

  function handleInvitesSkip() {
    finishOnboarding();
  }

  /**
   * F1-WEB-ONBOARD-05 (design, flujo de datos): `completeOnboarding()` "no
   * navega y espera" — el hook (`lib/tenant/hooks.ts`) ya esperó el resync
   * (`await resyncSession()`) para cuando ESTE callback corre, así que el
   * tenant fresco (`onboarded: true`) YA está en el store antes de navegar.
   * Mismo patrón que `handleBusinessSubmit`/`handleTemplateSubmit`/
   * `handleWarehouseSubmit`: navega SOLO en el `onSuccess` del `mutate()`.
   */
  function finishOnboarding() {
    completeOnboardingMutation.mutate(undefined, {
      onSuccess: () => navigate({ to: "/dashboard" }),
    });
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
        <StepFields
          key={effectiveStep}
          isSubmitting={updateTenantMutation.isPending}
          formError={
            updateTenantMutation.isError
              ? formErrorMessage(t, "onboarding.step2.error", updateTenantMutation.error)
              : undefined
          }
          onSubmit={handleFieldsSubmit}
        />
      )}
      {effectiveStep === 3 && (
        // W4: sin PATCH, sin mutación que observar — "Continuar" navega
        // sincrónico, nunca hay estado pendiente ni error que mostrar acá.
        <StepWarehouse key={effectiveStep} isSubmitting={false} onSubmit={handleWarehouseSubmit} />
      )}
      {effectiveStep === 4 && (
        <StepInvites
          key={effectiveStep}
          roles={roles ?? []}
          rolesUnavailable={rolesError}
          isSubmitting={isProcessingInvites || completeOnboardingMutation.isPending}
          rowResults={inviteResults}
          finishError={
            completeOnboardingMutation.isError
              ? formErrorMessage(
                  t,
                  "onboarding.step4.finishError",
                  completeOnboardingMutation.error,
                )
              : undefined
          }
          onSubmit={handleInvitesSubmit}
          onSkip={handleInvitesSkip}
        />
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
