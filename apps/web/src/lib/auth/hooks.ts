import { useMutation } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import {
  forgotPassword,
  type LoginInput,
  type LoginResponse,
  login,
  logout,
  type RegisterTenantInput,
  type RegisterTenantResponse,
  registerTenant,
  resetPassword,
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
