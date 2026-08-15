import { create } from "zustand";
import type { TenantBlock } from "@/lib/tenant/api";

/**
 * Usuario autenticado tal como lo devuelve `POST /auth/login` (LoginResult.user
 * del API). `permissions` alimenta el gating de UI por rol en fases siguientes.
 *
 * `tenant` (F1-WEB-ONBOARD-01, A1 del design): MISMO shape en `POST /auth/login`
 * Y en `GET /me` — un solo punto de siembra para `OnboardingGate` y el wizard,
 * sin importar si el store se llenó por login o por bootstrap/resync (ver
 * discovery "El store de auth se llena por DOS emisores").
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  locale: "es" | "en";
  permissions: string[];
  tenant: TenantBlock;
}

interface AuthState {
  /**
   * JWT de acceso — SOLO en memoria, nunca en localStorage. Al recargar la
   * página muere y se re-obtiene vía `/auth/refresh` (cookie httpOnly) —
   * eso lo hace el interceptor de F1-WEB-AUTH-02.
   */
  accessToken: string | null;
  user: AuthUser | null;
  /** Sesión completa post-login: token + usuario. */
  setAuth: (token: string, user: AuthUser) => void;
  /** Limpia toda la sesión (logout, refresh fallido). */
  clearAuth: () => void;
  /** Solo token: lo usa el refresh (F1-WEB-AUTH-02), que no devuelve user. */
  setToken: (token: string) => void;
  // NO agregar un `clearToken` que solo borre el token: existió, no tenía
  // llamadores, y era una trampa (S8 del re-verify). La purga de la caché de
  // React Query se dispara al cambiar la IDENTIDAD (`user.id`), así que
  // desloguear dejando `user` intacto NO purgaría y revivría en silencio el
  // CRITICAL C1 (el siguiente usuario viendo datos del anterior). Para cerrar
  // sesión hay UNA sola puerta: `clearAuth`.
  /**
   * Solo user: lo usa `/profile` al cambiar el idioma (F1-LOCALE-08), que
   * devuelve el usuario actualizado pero no un token nuevo. No-op si no había
   * sesión: sin `accessToken` un `user` suelto sería una sesión fantasma que
   * ProtectedRoute no reconoce.
   */
  setUser: (user: AuthUser) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (token, user) => set({ accessToken: token, user }),
  clearAuth: () => set({ accessToken: null, user: null }),
  setToken: (token) => set({ accessToken: token }),
  setUser: (user) => set((state) => (state.user === null ? state : { user })),
}));
