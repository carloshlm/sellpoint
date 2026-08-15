import { useMutation } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { resyncSession } from "@/lib/auth/session-resync";
import {
  completeOnboarding,
  type TenantBlock,
  type UpdateTenantInput,
  updateMyTenant,
} from "./api";

/**
 * F1-WEB-ONBOARD-01. A diferencia de `useUpdateUser`/`useUpdateRole`
 * (`lib/rbac/hooks.ts`, resync fire-and-forget con `void ...catch()`): acá el
 * wizard necesita el tenant FRESCO ya en el store ANTES de navegar al
 * siguiente paso — `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))`
 * seguiría viendo los datos viejos y el paso recién guardado se
 * re-mostraría (flash-back al paso anterior). Por eso `onSuccess` ES
 * async y SE ESPERA: React Query no resuelve `mutateAsync`/dispara el
 * `onSuccess` del call-site hasta que este termine.
 *
 * W2 (verify-report #357): NO se traga el error del resync con `.catch()`.
 * El PATCH sí persistió, pero si `/me` falla acá el store queda MINTIENDO
 * con el tenant viejo — dejar navegar igual (con el `.catch(() => {})`
 * original) hacía que el call-site (`goToStep`) SÍ corriera con datos
 * viejos: `effectiveStep` volvía a ver el piso anterior y el usuario
 * rebotaba al paso de antes SIN un solo mensaje (`isError` seguía en
 * `false` porque el PATCH, tomado aislado, tuvo éxito). Al no atrapar el
 * error acá, React Query considera la MUTACIÓN completa en error (el
 * `onSuccess` de nivel de hook lanzó) — el `onSuccess` del call-site
 * (`goToStep`) nunca corre, y `updateTenantMutation.isError` sí queda en
 * `true`, activando el mismo `formErrorMessage` que ya pinta cada paso.
 * Mismo patrón que `useCompleteOnboarding` (abajo), que ya no tragaba este
 * error y ya estaba testeado.
 */
export function useUpdateMyTenant() {
  return useMutation<TenantBlock, ApiError, UpdateTenantInput>({
    mutationFn: updateMyTenant,
    onSuccess: async () => {
      await resyncSession();
    },
  });
}

/**
 * F1-WEB-ONBOARD-05, paso 5 (cierre del wizard). Mismo motivo que
 * `useUpdateMyTenant`: el `onSuccess` ES async y SE ESPERA — el
 * call-site (`routes/onboarding.tsx`) navega a `/dashboard` recién en SU
 * PROPIO `onSuccess`, que React Query dispara después de este. Sin
 * esperar el resync, `user.tenant.onboarded` seguiría en `false` en el
 * store al llegar a `/dashboard` y `OnboardingGate` rebotaría de vuelta
 * a `/onboarding` (el mismo loop que A2 del design evita por
 * construcción). A diferencia del resync de los pasos 1-3, acá NO hay
 * red de seguridad `.catch()`: si el resync falla, el call-site no debe
 * navegar con el store desactualizado — se deja que el error se propague
 * para que el mutation quede en estado error y el usuario reintente.
 */
export function useCompleteOnboarding() {
  return useMutation<TenantBlock, ApiError, void>({
    mutationFn: completeOnboarding,
    onSuccess: async () => {
      await resyncSession();
    },
  });
}
