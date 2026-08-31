import type { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from "axios";
import axios from "axios";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-AUTH-02: refresh automático del access token con SINGLE-FLIGHT.
 *
 * ── Por qué el single-flight NO es una optimización, es correctitud ──
 * El backend rota la familia de refresh tokens en cada uso y trata un token
 * ya rotado como REUSO: revoca la familia entera y audita el evento como
 * posible robo (AD-6 de f1-auth). Si el access token expira con 3 requests
 * en vuelo, las 3 reciben 401 a la vez; un interceptor ingenuo dispararía 3
 * `/auth/refresh` en paralelo, el primero rotaría el token y los otros dos
 * llegarían con el token viejo -> el backend revoca TODO y el usuario cae a
 * /login sin haber hecho nada malo. Es el mismo bug de concurrencia que se
 * arregló del lado servidor (CRITICAL C1 del verify de f1-auth), gatillado
 * desde el cliente.
 *
 * La garantía: mientras un refresh está en vuelo, `refreshPromise` NO es
 * null y todas las requests que fallen con 401 esperan ESA promesa en vez de
 * pedir otro refresh. Un solo `/auth/refresh` por expiración, siempre.
 */

/** La promesa del refresh en curso, o null si no hay ninguno. */
let refreshPromise: Promise<string> | null = null;

/**
 * Endpoints donde un 401 significa "credenciales/token inválidos", NO
 * "tu sesión expiró". Reintentar acá sería absurdo (y en `/auth/refresh`
 * causaría recursión infinita).
 */
const PUBLIC_AUTH_PATHS = [
  "/auth/login",
  "/auth/refresh",
  "/auth/register-tenant",
  "/auth/verify-email",
  "/auth/forgot-password",
  "/auth/reset-password",
] as const;

function isPublicAuthPath(url: string | undefined): boolean {
  if (!url) return false;
  return PUBLIC_AUTH_PATHS.some((path) => url.startsWith(path) || url.endsWith(path));
}

/**
 * Un 401 no siempre significa "tu sesión expiró". `POST /auth/change-password`
 * (F1-WEB-AUTH-10) responde 401 `auth.invalid_credentials` cuando la password
 * ACTUAL está mal — refrescar el token y reintentar repetiría exactamente el
 * mismo intento fallido: doble verificación argon2, doble fila de auditoría y
 * doble consumo del throttle de IP (5 cada 15 min) por cada typo.
 *
 * Se distingue por la clave i18n cruda del backend, no por la URL: cualquier
 * endpoint futuro que pida re-autenticación hereda el comportamiento correcto
 * sin tocar esta lista. `auth.token_stale` / `auth.invalid_token` NO están
 * acá: esos SÍ son sesión y deben refrescar.
 */
function isCredentialRejection(error: AxiosError): boolean {
  const code = (error.response?.data as { code?: unknown } | undefined)?.code;
  return code === "auth.invalid_credentials";
}

/** Marca interna: una request se reintenta A LO SUMO una vez. */
type RetriableConfig = InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean };

/**
 * Cliente SEPARADO para el refresh: si usara la instancia principal, el 401
 * del propio refresh volvería a entrar en este interceptor y recursaría.
 * Comparte baseURL y `withCredentials` (la cookie httpOnly es lo único que
 * autentica este endpoint — no lleva Authorization).
 */
function createRefreshClient(api: AxiosInstance): AxiosInstance {
  return axios.create({
    baseURL: api.defaults.baseURL,
    withCredentials: true,
    timeout: api.defaults.timeout,
    headers: { "Content-Type": "application/json" },
    // Hereda el adaptador del cliente principal. En producción es el default
    // de axios; en tests, el fake que instala el spec — así el refresh es
    // observable sin exponer una costura solo-para-tests en la firma.
    adapter: api.defaults.adapter,
  });
}

export function installRefreshInterceptor(api: AxiosInstance): void {
  const refreshClient = createRefreshClient(api);

  // --- Request: adjunta el token vigente del store -------------------------
  api.interceptors.request.use((config) => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  // --- Response: 401 -> refresh (single-flight) -> reintento ---------------
  // OJO: este interceptor se registra ANTES del normalizador de errores de
  // `api.ts`, así recibe el AxiosError crudo (con `config`, necesario para
  // reintentar). El normalizador corre después sobre lo que acá se rechace.
  api.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as RetriableConfig | undefined;
      const status = error.response?.status;

      const shouldTryRefresh =
        status === 401 &&
        config !== undefined &&
        config._retriedAfterRefresh !== true &&
        !isPublicAuthPath(config.url) &&
        !isCredentialRejection(error);

      if (!shouldTryRefresh) {
        return Promise.reject(error);
      }

      // `config` está garantizado por shouldTryRefresh.
      const retriableConfig = config as RetriableConfig;
      retriableConfig._retriedAfterRefresh = true;

      try {
        const token = await runSingleFlightRefresh(refreshClient);
        retriableConfig.headers.Authorization = `Bearer ${token}`;
        return await api.request(retriableConfig);
      } catch (fallo) {
        // El refresh falló. **Solo un 401/403 significa sesión muerta**
        // (refresh expirado, familia revocada): ahí se limpia para que
        // ProtectedRoute expulse a /login de forma reactiva.
        //
        // Un 429 —el límite de volumen tras navegar rápido—, un 5xx o la red
        // caída son TEMPORALES: desloguear por eso expulsa a alguien cuya
        // cookie sigue siendo válida y le hace perder lo que estuviera
        // haciendo (Carlos, 2026-08-31). Se deja la sesión en pie y se
        // rechaza la request; la siguiente volverá a intentar.
        const status = (fallo as { statusCode?: number; response?: { status?: number } } | null)
          ?.statusCode;
        const httpStatus =
          status ?? (fallo as { response?: { status?: number } } | null)?.response?.status;
        if (httpStatus === 401 || httpStatus === 403) {
          useAuthStore.getState().clearAuth();
        }
        // Se rechaza con el error ORIGINAL, no con el del refresh: al
        // llamador le importa que SU request falló.
        return Promise.reject(error);
      }
    },
  );
}

/**
 * Devuelve el token nuevo, garantizando UNA sola llamada a `/auth/refresh`
 * por más requests concurrentes que fallen: la primera crea la promesa, las
 * demás se cuelgan de la misma. El `finally` la limpia para que la próxima
 * expiración vuelva a intentar (sin él, un refresh fallido dejaría la app
 * incapaz de recuperarse hasta recargar).
 */
async function runSingleFlightRefresh(refreshClient: AxiosInstance): Promise<string> {
  refreshPromise ??= requestNewAccessToken(refreshClient).finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

async function requestNewAccessToken(refreshClient: AxiosInstance): Promise<string> {
  const { data } = await refreshClient.post<{ accessToken: string; expiresIn: number }>(
    "/auth/refresh",
  );
  // Solo el token: `/auth/refresh` no devuelve el usuario (contrato del
  // AuthController), por eso `setToken` y no `setAuth` — el `user` del store
  // se conserva si ya estaba.
  useAuthStore.getState().setToken(data.accessToken);
  return data.accessToken;
}

/** Solo para tests: descarta el refresh en vuelo entre casos. */
export function __resetRefreshStateForTests(): void {
  refreshPromise = null;
}
