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
  lifecycle: TenantLifecycleView;
}

/**
 * F7-LIFECYCLE-07 — el ciclo de vida como lo calcula el API (el web NUNCA
 * compara fechas: `deletable` y `deletableAt` vienen resueltos).
 */
export interface TenantLifecycleView {
  suspendedAt: string | null;
  suspendedBy: { id: string; name: string } | null;
  reason: string | null;
  suspendedDays: number;
  deletableAt: string | null;
  deletable: boolean;
}

export async function suspendTenant(
  tenantId: string,
  reason: string,
): Promise<TenantLifecycleView> {
  const { data } = await api.post<TenantLifecycleView>(`/admin/tenants/${tenantId}/suspend`, {
    reason,
  });
  return data;
}

export async function reactivateTenant(tenantId: string): Promise<TenantLifecycleView> {
  const { data } = await api.post<TenantLifecycleView>(`/admin/tenants/${tenantId}/reactivate`);
  return data;
}

/** Irreversible: el nombre exacto y la contraseña del PROPIO administrador. */
export async function deleteTenant(
  tenantId: string,
  input: { password: string; confirmName: string },
): Promise<{ purged: true; name: string }> {
  const { data } = await api.delete<{ purged: true; name: string }>(`/admin/tenants/${tenantId}`, {
    data: input,
  });
  return data;
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
