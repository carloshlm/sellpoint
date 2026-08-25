import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { SessionLoading } from "@/components/auth/session-loading";
import { StepBusiness } from "@/components/onboarding/step-business";
import { StepTheme, type ThemeChoice } from "@/components/onboarding/step-theme";
import { StepWarehouse } from "@/components/onboarding/step-warehouse";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import type { ApiError } from "@/lib/api";
import { useCompleteOnboarding, useUpdateMyTenant } from "@/lib/tenant/hooks";
import type { BusinessStepValues } from "@/lib/tenant/schemas";
import { primerPasoIncompleto } from "@/lib/tenant/steps";
import { useWarehouses } from "@/lib/warehouses/hooks";
import { useAuthStore } from "@/stores/auth.store";

interface OnboardingSearch {
  // W1 (verify-report #357): `step` es OPCIONAL — ausente (entrada desde el
  // gate, o `/onboarding` a secas) YA NO equivale a "pedí el paso 1". Ver
  // `effectiveStep` en `OnboardingContent`: sin `step`, el paso por defecto
  // es el DERIVADO del tenant (`primerPasoIncompleto`), no un fijo en 1.
  step?: 1 | 2 | 3;
}

function clampStep(value: unknown): 1 | 2 | 3 | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 3) {
    return parsed as 1 | 2 | 3;
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
 * A3 del design: UNA sola ruta con `?step=`, acotado a 1..3 por
 * `validateSearch`. El paso EFECTIVO nunca es el pedido a ciegas —
 * `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))` — así que
 * escribir `?step=3` a mano no salta el negocio incompleto.
 *
 * El wizard de 3 pasos (Carlos, 2026-08-25): negocio → almacén → tema. Los
 * pasos de campos del catálogo y de invitar al equipo se quitaron para
 * agilizar el registro — ambos siguen disponibles después (Catálogo → Campos
 * y Sistema → Usuarios).
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
  // F2-ONBOARD-03: el piso del paso 2 depende de si ya existe un almacén.
  // Va ACÁ, antes de cualquier return temprano: un hook después de un `if`
  // que retorna rompe el orden de hooks entre renders.
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
    // `undefined` mientras carga: no se baja el piso a 2 con datos a medias,
    // que haría parpadear el wizard.
    hasWarehouse: warehouses === undefined ? undefined : warehouses.length > 0,
  });
  const effectiveStep = (step === undefined ? piso : Math.min(step, piso)) as 1 | 2 | 3;

  function goToStep(next: 1 | 2 | 3) {
    navigate({ search: () => ({ step: next }) });
  }

  function handleBusinessSubmit(values: BusinessStepValues) {
    // `name: legalName` — el registro ya no pide "Nombre del negocio"
    // (Carlos, 2026-08-25): este paso lo nombra, reemplazando el provisional
    // con el que nació el tenant.
    updateTenantMutation.mutate(
      { ...values, name: values.legalName },
      {
        // A4 del design: navega SOLO en onSuccess. El hook ya esperó el
        // resync (ver lib/tenant/hooks.ts) — para cuando este callback corre,
        // el tenant fresco YA está en el store.
        onSuccess: () => goToStep(2),
      },
    );
  }

  // W4 (verify-report #357): el paso del almacén no tiene formulario ni datos
  // (F2, D2) y NO dispara ningún PATCH — el piso puro ya avanza solo cuando
  // el almacén existe, así que `goToStep(3)` alcanza.
  function handleWarehouseSubmit() {
    goToStep(3);
  }

  /**
   * El cierre del wizard (Carlos, 2026-08-25): guardar el tema elegido y
   * completar el onboarding, ENCADENADOS — el tema primero, porque si su
   * PATCH falla el usuario sigue en el paso 3 con el error a la vista, no
   * onboarded con la preferencia perdida.
   */
  function handleThemeSubmit(theme: ThemeChoice) {
    updateTenantMutation.mutate(
      { theme },
      {
        onSuccess: () => {
          completeOnboardingMutation.mutate(undefined, {
            onSuccess: () => navigate({ to: "/dashboard" }),
          });
        },
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
        // W4: sin PATCH, sin mutación que observar — "Continuar" navega
        // sincrónico, nunca hay estado pendiente ni error que mostrar acá.
        <StepWarehouse key={effectiveStep} isSubmitting={false} onSubmit={handleWarehouseSubmit} />
      )}
      {effectiveStep === 3 && (
        <StepTheme
          key={effectiveStep}
          isSubmitting={updateTenantMutation.isPending || completeOnboardingMutation.isPending}
          formError={
            (updateTenantMutation.error ?? completeOnboardingMutation.error)
              ? formErrorMessage(
                  t,
                  "onboarding.step3.error",
                  (updateTenantMutation.error ?? completeOnboardingMutation.error) as ApiError,
                )
              : undefined
          }
          onSubmit={handleThemeSubmit}
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
