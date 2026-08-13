import { useEffect } from "react";
import { create } from "zustand";
import { getMe, refreshSession } from "@/lib/auth/api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Bootstrap de sesión al cargar la app: el access token vive SOLO en memoria
 * (auth.store), así que un reload lo mata aunque la cookie httpOnly de
 * refresh siga viva. Antes de decidir una ruta protegida hay que preguntarle
 * al backend "¿esta cookie todavía vale?" — si vale, se reconstruye la sesión
 * (token + `GET /me`); si no, sesión limpia y a /login.
 *
 * ── Decisión: refresh propio, NO el del interceptor ──
 * El interceptor de F1-WEB-AUTH-02 refresca REACTIVAMENTE (ante un 401 de una
 * request con token). Acá no hay token ni request que falle: es un refresh
 * PROACTIVO de arranque. Se llama `POST /auth/refresh` vía la instancia
 * principal — sin recursión porque `/auth/refresh` está en PUBLIC_AUTH_PATHS
 * del interceptor — y con single-flight PROPIO (`bootstrapPromise`): corre a
 * lo sumo una vez por carga de página, aunque StrictMode monte los efectos
 * dos veces. No compite con el single-flight del interceptor: mientras el
 * bootstrap está `pending`, el gate de ProtectedRoute todavía no montó UI
 * protegida, así que no hay requests autenticadas en vuelo.
 */

export type SessionStatus = "pending" | "authenticated" | "anonymous";

interface SessionState {
  status: SessionStatus;
}

export const useSessionStore = create<SessionState>(() => ({
  status: "pending" as SessionStatus,
}));

/** El bootstrap en curso (o ya terminado): una sola vez por carga de página. */
let bootstrapPromise: Promise<void> | null = null;

export function bootstrapSession(): Promise<void> {
  bootstrapPromise ??= runBootstrap();
  return bootstrapPromise;
}

async function runBootstrap(): Promise<void> {
  // Navegación en caliente (login recién hecho): ya hay sesión, no hay nada
  // que revivir — y NO hay que pisar el token vigente con otro refresh.
  if (useAuthStore.getState().accessToken) {
    useSessionStore.setState({ status: "authenticated" });
    return;
  }

  try {
    const { accessToken } = await refreshSession();
    // Token primero: `GET /me` viaja con este Bearer (interceptor de request).
    useAuthStore.getState().setToken(accessToken);
    const user = await getMe();
    useAuthStore.getState().setAuth(accessToken, user);
    useSessionStore.setState({ status: "authenticated" });
  } catch {
    // Sin cookie, familia revocada o backend caído: no dejamos sesión a
    // medias (token sin user) — todo o nada.
    useAuthStore.getState().clearAuth();
    useSessionStore.setState({ status: "anonymous" });
  }
}

/** Container hook: dispara el bootstrap al montar la app (root layout). */
export function useSessionBootstrap(): void {
  useEffect(() => {
    void bootstrapSession();
  }, []);
}

export function useSessionStatus(): SessionStatus {
  return useSessionStore((state) => state.status);
}

/** Solo para tests: vuelve al estado de "página recién cargada". */
export function __resetSessionBootstrapForTests(): void {
  bootstrapPromise = null;
  useSessionStore.setState({ status: "pending" });
}
