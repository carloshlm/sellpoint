import { useMutation } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { resyncSession } from "@/lib/auth/session-resync";
import { type TenantBlock, type UpdateTenantInput, updateMyTenant } from "./api";

/**
 * F1-WEB-ONBOARD-01. A diferencia de `useUpdateUser`/`useUpdateRole`
 * (`lib/rbac/hooks.ts`, resync fire-and-forget con `void ...catch()`): acá el
 * wizard necesita el tenant FRESCO ya en el store ANTES de navegar al
 * siguiente paso — `effectiveStep = min(stepPedido, primerPasoIncompleto(tenant))`
 * seguiría viendo los datos viejos y el paso recién guardado se
 * re-mostraría (flash-back al paso anterior). Por eso `onSuccess` ES
 * async y SE ESPERA: React Query no resuelve `mutateAsync`/dispara el
 * `onSuccess` del call-site hasta que este termine. Con red de
 * seguridad (`.catch()`): si el resync falla, el PATCH ya se guardó del
 * lado del server — el usuario reintenta "Continuar" sin perder nada.
 */
export function useUpdateMyTenant() {
  return useMutation<TenantBlock, ApiError, UpdateTenantInput>({
    mutationFn: updateMyTenant,
    onSuccess: async () => {
      await resyncSession().catch(() => {});
    },
  });
}
