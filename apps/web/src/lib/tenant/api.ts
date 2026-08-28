import { api } from "@/lib/api";

/**
 * F1-WEB-ONBOARD-01: espejo EXACTO de `TenantBlock` (apps/api,
 * tenant.types.ts) — MISMO shape que `AuthUser.tenant` (auth.store.ts),
 * A1 del design. Gemelo estructural de `lib/rbac/api.ts`.
 *
 * `country` (ad-hoc post-Fase 1, 2026-08-16, MERCADOS.md §2): ISO 3166-1
 * alpha-2 o `null` en un tenant que todavía no pasó el paso 1 del wizard
 * con el campo país — `string`, no `CountryCode`, mismo criterio que el
 * backend (`tenant.types.ts`): es un pass-through de lo ya persistido, no
 * revalida contra el catálogo compartido.
 */
export interface TenantBlock {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  theme: string | null;
  timezone: string;
  currency: string;
  templateChoice: string | null;
  onboarded: boolean;
  country: string | null;
  /** F7-POS-05: el toggle "Vender sin existencias" de los ajustes del negocio. */
  sellWithoutStock: boolean;
}

/** PATCH parcial — espejo de `update-tenant.dto.ts` (apps/api). */
export type UpdateTenantInput = Partial<
  Pick<
    TenantBlock,
    | "name"
    | "legalName"
    | "taxId"
    | "address"
    | "phone"
    | "theme"
    | "timezone"
    | "currency"
    | "templateChoice"
    | "country"
    | "sellWithoutStock"
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
