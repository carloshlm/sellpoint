import { create } from "zustand";

/**
 * Usuario autenticado tal como lo devuelve `POST /auth/login` (LoginResult.user
 * del API). `permissions` alimenta el gating de UI por rol en fases siguientes.
 */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  locale: "es" | "en";
  permissions: string[];
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
  clearToken: () => void;
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
  clearToken: () => set({ accessToken: null }),
  setUser: (user) => set((state) => (state.user === null ? state : { user })),
}));
