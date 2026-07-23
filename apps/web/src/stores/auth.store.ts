import { create } from "zustand";

interface AuthState {
  /** JWT de acceso — SOLO en memoria, nunca en localStorage */
  accessToken: string | null;
  setToken: (token: string) => void;
  clearToken: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  setToken: (token) => set({ accessToken: token }),
  clearToken: () => set({ accessToken: null }),
}));
