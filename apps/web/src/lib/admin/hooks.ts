import type { ModuleKey } from "@sellpoint/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { disableModule, type EnableModuleInput, enableModule } from "@/lib/billing/api";
import type { UserDetail } from "@/lib/rbac/api";
import {
  getTenantOverview,
  listTenantUsers,
  reactivateTenantUser,
  suspendTenantUser,
  type TenantOverview,
} from "./api";

export const ADMIN_TENANT_KEY = ["admin", "tenant"] as const;

export function useTenantOverview(tenantId: string) {
  return useQuery<TenantOverview, ApiError>({
    queryKey: [...ADMIN_TENANT_KEY, tenantId, "overview"],
    queryFn: () => getTenantOverview(tenantId),
  });
}

export function useTenantUsers(tenantId: string) {
  return useQuery<UserDetail[], ApiError>({
    queryKey: [...ADMIN_TENANT_KEY, tenantId, "users"],
    queryFn: () => listTenantUsers(tenantId),
  });
}

/** Tras cualquier cambio se invalida TODO el expediente y la lista de cobros: los conteos cambian. */
function useInvalidateTenant(tenantId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [...ADMIN_TENANT_KEY, tenantId] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "billing"] });
  };
}

export function useSuspendTenantUser(tenantId: string) {
  const invalidar = useInvalidateTenant(tenantId);
  return useMutation<UserDetail, ApiError, string>({
    mutationFn: (userId) => suspendTenantUser(tenantId, userId),
    onSuccess: invalidar,
  });
}

export function useReactivateTenantUser(tenantId: string) {
  const invalidar = useInvalidateTenant(tenantId);
  return useMutation<UserDetail, ApiError, string>({
    mutationFn: (userId) => reactivateTenantUser(tenantId, userId),
    onSuccess: invalidar,
  });
}

export function useEnableModule(tenantId: string) {
  const invalidar = useInvalidateTenant(tenantId);
  return useMutation<ModuleKey[], ApiError, EnableModuleInput>({
    mutationFn: (input) => enableModule(tenantId, input),
    onSuccess: invalidar,
  });
}

export function useDisableModule(tenantId: string) {
  const invalidar = useInvalidateTenant(tenantId);
  return useMutation<ModuleKey[], ApiError, { moduleKey: ModuleKey; reason: string }>({
    mutationFn: ({ moduleKey, reason }) => disableModule(tenantId, moduleKey, reason),
    onSuccess: invalidar,
  });
}
