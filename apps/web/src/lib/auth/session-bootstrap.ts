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

export type SessionStatus = "pending" | "authenticated" | "anonymous" | "unavailable";

/**
 * Cuántas veces se reintenta un fallo TEMPORAL antes de rendirse, y cuánto se
 * espera entre intentos. Un 429 del límite global vive como mucho 60 s, así
 * que dos esperas cortas cubren el caso real —recargar rápido— sin dejar al
 * usuario mirando un spinner eterno si el backend está de verdad caído.
 */
const REINTENTOS_TEMPORALES = 2;
const ESPERA_MS = 1500;

/**
 * ¿Este fallo significa que la sesión se ACABÓ, o solo que ahora no se pudo?
 *
 * Un 401 es definitivo: la cookie no vale (expiró, la familia se revocó). Un
 * 429, un 5xx o un fallo de red son temporales — y tratarlos como sesión
 * muerta expulsa al usuario y le hace perder lo que estuviera haciendo.
 *
 * Le pasó a Carlos (2026-08-31): quince recargas en quince segundos tocaron
 * el límite global de 100/minuto, el refresh del arranque recibió 429, y el
 * `catch` ciego de acá lo mandó al login con la sesión perfectamente viva.
 */
function esSesionMuerta(error: unknown): boolean {
  const status = (error as { statusCode?: number } | null | undefined)?.statusCode;
  return status === 401 || status === 403;
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  for (let intento = 0; intento <= REINTENTOS_TEMPORALES; intento += 1) {
    try {
      const { accessToken } = await refreshSession();
      // Token primero: `GET /me` viaja con este Bearer (interceptor de request).
      useAuthStore.getState().setToken(accessToken);
      const user = await getMe();
      useAuthStore.getState().setAuth(accessToken, user);
      useSessionStore.setState({ status: "authenticated" });
      return;
    } catch (error) {
      // Sesión muerta: no se deja a medias (token sin user) — todo o nada.
      // Insistir no la revive, así que se corta acá.
      if (esSesionMuerta(error)) {
        useAuthStore.getState().clearAuth();
        useSessionStore.setState({ status: "anonymous" });
        return;
      }
      if (intento < REINTENTOS_TEMPORALES) {
        await esperar(ESPERA_MS);
      }
    }
  }

  // Se agotaron los reintentos de un fallo temporal. Se limpia lo que haya
  // quedado a medias —un token sin user es peor que nada: ProtectedRoute
  // renderizaría la app sin usuario— pero **NO se declara anónimo**: la
  // cookie de refresh puede seguir siendo válida, y el usuario merece un
  // "reintentar" en vez de un login que le haga perder el trabajo.
  useAuthStore.getState().clearAuth();
  useSessionStore.setState({ status: "unavailable" });
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
