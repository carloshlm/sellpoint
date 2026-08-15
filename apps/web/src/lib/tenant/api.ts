import { api } from "@/lib/api";

/**
 * F1-WEB-ONBOARD-01: espejo EXACTO de `TenantBlock` (apps/api,
 * tenant.types.ts) — MISMO shape que `AuthUser.tenant` (auth.store.ts),
 * A1 del design. Gemelo estructural de `lib/rbac/api.ts`.
 */
export interface TenantBlock {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  timezone: string;
  currency: string;
  templateChoice: string | null;
  // F1-WEB-ONBOARD-03 (apply-progress Deviation 6): NO es dato real de
  // almacén (esto sigue siendo F2, D2) — es la única señal server-side de
  // que el paso 3 (placeholder) ya se recorrió. Sin esto, `primerPasoIncompleto`
  // no tiene forma de distinguir "recién llegó al paso 3" de "ya lo pasó",
  // así que `Continuar` en el paso 3 rebotaría al mismo paso (incluso sin
  // recargar) en vez de avanzar al 4.
  warehouseStepSeen: boolean;
  onboarded: boolean;
}

/** PATCH parcial — espejo de `update-tenant.dto.ts` (apps/api). */
export type UpdateTenantInput = Partial<
  Pick<
    TenantBlock,
    | "name"
    | "legalName"
    | "taxId"
    | "address"
    | "timezone"
    | "currency"
    | "templateChoice"
    | "warehouseStepSeen"
  >
>;

export async function getMyTenant(): Promise<TenantBlock> {
  const { data } = await api.get<TenantBlock>("/tenants/me");
  return data;
}

export async function updateMyTenant(input: UpdateTenantInput): Promise<TenantBlock> {
  const { data } = await api.patch<TenantBlock>("/tenants/me", input);
  return data;
}

// 200, no 201/204: transición de estado sobre un recurso existente (mismo
// criterio que `suspendUser`/`reactivateUser` en lib/rbac/api.ts).
export async function completeOnboarding(): Promise<TenantBlock> {
  const { data } = await api.post<TenantBlock>("/tenants/me/complete-onboarding");
  return data;
}
