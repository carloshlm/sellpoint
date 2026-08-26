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

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
}

/**
 * Refresh EXPLÍCITO para el bootstrap de sesión (tras reload no hay token en
 * memoria; autentica la cookie httpOnly). Va por la instancia principal SIN
 * riesgo de recursión: `/auth/refresh` está en PUBLIC_AUTH_PATHS del
 * interceptor, así que su propio 401 nunca dispara otro refresh.
 */
export async function refreshSession(): Promise<RefreshResponse> {
  const { data } = await api.post<RefreshResponse>("/auth/refresh");
  return data;
}

/** GET /me — identidad fresca del user autenticado (el JWT no trae email/firstName). */
export async function getMe(): Promise<AuthUser> {
  const { data } = await api.get<AuthUser>("/me");
  return data;
}

/** Revoca la familia de refresh tokens y limpia la cookie httpOnly (204). */
export async function logout(): Promise<void> {
  await api.post("/auth/logout");
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * F1-WEB-AUTH-10. Devuelve un access token NUEVO que el llamador DEBE guardar:
 * el backend bumpea `perm-epoch:{userId}` para matar las otras sesiones, y ese
 * bump también invalida el token con el que se hizo esta request. El token
 * devuelto se firmó después del bump, así que es el único vivo.
 */
export async function changePassword(input: ChangePasswordInput): Promise<RefreshResponse> {
  const { data } = await api.post<RefreshResponse>("/auth/change-password", input);
  return data;
}

/**
 * Sesión activa = FAMILIA de refresh tokens viva. El backend no guarda
 * userAgent ni IP, así que no hay "Chrome en Windows" para mostrar: solo
 * cuándo empezó, cuándo vence y si es la sesión desde la que estás mirando.
 */
export interface ActiveSession {
  familyId: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export async function getSessions(): Promise<ActiveSession[]> {
  const { data } = await api.get<ActiveSession[]>("/auth/sessions");
  return data;
}

/** F1-LOCALE-08: `PATCH /me` persiste el idioma preferido del usuario. */
export async function updateMyLocale(locale: "es" | "en"): Promise<{ locale: string }> {
  const { data } = await api.patch<{ locale: string }>("/me", { locale });
  return data;
}

/**
 * "Tus datos" editable (2026-08-26): nombre y apellidos por el mismo
 * `PATCH /me`. El email NO viaja — es la identidad de acceso y el backend
 * lo rechaza. `lastNameMaternal: null` lo borra (es opcional del registro).
 */
export interface UpdateMyProfileInput {
  firstName?: string;
  lastNamePaternal?: string;
  lastNameMaternal?: string | null;
}

export interface MyProfileSummary {
  id: string;
  email: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
  status: string;
  locale: string;
}

export async function updateMyProfile(input: UpdateMyProfileInput): Promise<MyProfileSummary> {
  const { data } = await api.patch<MyProfileSummary>("/me", input);
  return data;
}
