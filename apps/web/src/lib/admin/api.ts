import type { ModuleKey } from "@sellpoint/shared";
import { api } from "@/lib/api";
import type { UserDetail } from "@/lib/rbac/api";

/** Espejo de `TenantOverview` del API (F9-ADMIN-02). */
export interface TenantOverview {
  tenant: {
    name: string;
    country: string | null;
    currency: string;
    timezone: string;
    onboarded: boolean;
  };
  users: { active: number; invited: number; suspended: number };
  counts: { products: number; services: number; subcatalogs: number; warehouses: number };
  subscription: {
    planCode: string;
    planName: string | null;
    status: string;
    billingCycle: string | null;
    dueAt: string | null;
    customPrice: string | null;
  };
  modules: ModuleKey[];
}

/**
 * F9-ADMIN-07/08 — el expediente del negocio. Vive aparte de `lib/rbac`,
 * que apunta a `/users` del negocio PROPIO: mezclar los dos sería la forma
 * más fácil de suspender al usuario equivocado.
 */
export async function getTenantOverview(tenantId: string): Promise<TenantOverview> {
  const { data } = await api.get<TenantOverview>(`/admin/tenants/${tenantId}/overview`);
  return data;
}

export async function listTenantUsers(tenantId: string): Promise<UserDetail[]> {
  const { data } = await api.get<UserDetail[]>(`/admin/tenants/${tenantId}/users`);
  return data;
}

export async function suspendTenantUser(tenantId: string, userId: string): Promise<UserDetail> {
  const { data } = await api.post<UserDetail>(`/admin/tenants/${tenantId}/users/${userId}/suspend`);
  return data;
}

export async function reactivateTenantUser(tenantId: string, userId: string): Promise<UserDetail> {
  const { data } = await api.post<UserDetail>(
    `/admin/tenants/${tenantId}/users/${userId}/reactivate`,
  );
  return data;
}
