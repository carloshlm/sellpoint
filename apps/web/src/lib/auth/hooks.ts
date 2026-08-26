import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  type ActiveSession,
  type ChangePasswordInput,
  changePassword,
  forgotPassword,
  getSessions,
  type LoginInput,
  type LoginResponse,
  login,
  logout,
  type MyProfileSummary,
  type RefreshResponse,
  type RegisterTenantInput,
  type RegisterTenantResponse,
  registerTenant,
  resetPassword,
  type UpdateMyProfileInput,
  updateMyLocale,
  updateMyProfile,
  verifyEmail,
} from "@/lib/auth/api";

/**
 * Mutaciones de auth: capa de lógica para los containers (rutas). La
 * navegación y el manejo del store quedan en cada container — acá solo vive
 * el wiring React Query ↔ API con errores tipados como ApiError.
 */

export function useLogin() {
  return useMutation<LoginResponse, ApiError, LoginInput>({ mutationFn: login });
}

export function useRegisterTenant() {
  return useMutation<RegisterTenantResponse, ApiError, RegisterTenantInput>({
    mutationFn: registerTenant,
  });
}

export function useVerifyEmail() {
  return useMutation<void, ApiError, string>({ mutationFn: verifyEmail });
}

export function useLogout() {
  return useMutation<void, ApiError, void>({ mutationFn: logout });
}

export function useForgotPassword() {
  return useMutation<void, ApiError, string>({ mutationFn: forgotPassword });
}

export function useResetPassword() {
  return useMutation<void, ApiError, { token: string; password: string }>({
    mutationFn: ({ token, password }) => resetPassword(token, password),
  });
}

/** Clave de la lista de sesiones: el cambio de password la invalida (mató otras). */
export const SESSIONS_QUERY_KEY = ["auth", "sessions"] as const;

export function useChangePassword() {
  return useMutation<RefreshResponse, ApiError, ChangePasswordInput>({
    mutationFn: changePassword,
  });
}

export function useActiveSessions(enabled = true) {
  return useQuery<ActiveSession[], ApiError>({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: getSessions,
    enabled,
  });
}

export function useUpdateLocale() {
  return useMutation<{ locale: string }, ApiError, "es" | "en">({ mutationFn: updateMyLocale });
}

/** "Tus datos" editable (2026-08-26): PATCH parcial de nombre y apellidos. */
export function useUpdateMyProfile() {
  return useMutation<MyProfileSummary, ApiError, UpdateMyProfileInput>({
    mutationFn: updateMyProfile,
  });
}
