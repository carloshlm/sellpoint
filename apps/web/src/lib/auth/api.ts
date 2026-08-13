import { api } from "@/lib/api";
import type { AuthUser } from "@/stores/auth.store";

/** Contratos reales del AuthController (apps/api) — verificados contra el código. */

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

export interface RegisterTenantInput {
  tenantName: string;
  email: string;
  password: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal?: string;
  locale?: "es" | "en";
}

export interface RegisterTenantResponse {
  tenantId: string;
  userId: string;
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>("/auth/login", input);
  return data;
}

export async function registerTenant(input: RegisterTenantInput): Promise<RegisterTenantResponse> {
  const { data } = await api.post<RegisterTenantResponse>("/auth/register-tenant", input);
  return data;
}

export async function verifyEmail(token: string): Promise<void> {
  await api.post("/auth/verify-email", { token });
}

/** 202 SIEMPRE (anti-enumeración): mismo resultado exista o no el email. */
export async function forgotPassword(email: string): Promise<void> {
  await api.post("/auth/forgot-password", { email });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await api.post("/auth/reset-password", { token, password });
}
