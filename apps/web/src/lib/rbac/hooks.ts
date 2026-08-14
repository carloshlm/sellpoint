import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type CreateRoleInput,
  type CreateUserInput,
  createRole,
  createUser,
  deleteRole,
  listPermissions,
  listRoles,
  listUsers,
  type PermissionGroup,
  type RoleSummary,
  reactivateUser,
  resendInvitation,
  suspendUser,
  type UpdateRoleInput,
  type UpdateUserInput,
  type UserDetail,
  updateRole,
  updateUser,
} from "./api";

/**
 * Queries y mutaciones de `lib/rbac/`. A diferencia de `lib/auth/hooks.ts`
 * (donde la invalidación vive en cada container), acá vive DENTRO del hook:
 * es la misma decisión que `watchSessionIdentity` en `query-client.ts` — una
 * consecuencia de la mutación, no un paso que un container futuro pueda
 * olvidar repetir (D3 del design).
 */

export const USERS_QUERY_KEY = ["rbac", "users"] as const;
export const ROLES_QUERY_KEY = ["rbac", "roles"] as const;
export const PERMISSIONS_QUERY_KEY = ["rbac", "permissions"] as const;

export function useUsers() {
  return useQuery<UserDetail[], ApiError>({ queryKey: USERS_QUERY_KEY, queryFn: listUsers });
}

export function useRoles() {
  return useQuery<RoleSummary[], ApiError>({ queryKey: ROLES_QUERY_KEY, queryFn: listRoles });
}

/**
 * Catálogo COMPLETO de permisos posibles (agrupado por módulo). Nombre
 * deliberadamente distinto de `usePermissions()` (`lib/auth/permissions.ts`):
 * ese es el gating del ACTOR sobre SUS permisos; este es el catálogo entero
 * que alimenta el editor de roles.
 */
export function usePermissionsCatalog() {
  return useQuery<PermissionGroup[], ApiError>({
    queryKey: PERMISSIONS_QUERY_KEY,
    queryFn: listPermissions,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation<UserDetail, ApiError, CreateUserInput>({
    mutationFn: createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation<UserDetail, ApiError, { id: string; input: UpdateUserInput }>({
    mutationFn: ({ id, input }) => updateUser(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useSuspendUser() {
  const queryClient = useQueryClient();
  return useMutation<UserDetail, ApiError, string>({
    mutationFn: suspendUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useReactivateUser() {
  const queryClient = useQueryClient();
  return useMutation<UserDetail, ApiError, string>({
    mutationFn: reactivateUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useResendInvitation() {
  const queryClient = useQueryClient();
  return useMutation<UserDetail, ApiError, string>({
    mutationFn: resendInvitation,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation<RoleSummary, ApiError, CreateRoleInput>({
    mutationFn: createRole,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation<RoleSummary, ApiError, { id: string; input: UpdateRoleInput }>({
    mutationFn: ({ id, input }) => updateRole(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, string>({
    mutationFn: deleteRole,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
    },
  });
}
