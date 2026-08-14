import { QueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";

/**
 * El QueryClient de la app. Es una FACTORY, no un singleton exportado, por dos
 * razones que se pagaron caro:
 *
 * 1. El verify de f1-web-auth encontró C1 (caché sucia tras el logout) porque
 *    el arnés de tests creaba `new QueryClient()` en cada render mientras la
 *    app compartía UNO solo por pestaña: el arnés aislaba por construcción
 *    justo lo que la app comparte, así que el bug era invisible. Con una
 *    factory, los tests construyen el MISMO objeto —mismos defaults, misma
 *    vigilancia de sesión— y la divergencia deja de ser posible.
 * 2. Un singleton de módulo con una suscripción viva es un dolor para aislar
 *    entre tests.
 */
export function createQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetryQuery },
    },
  });

  watchSessionIdentity(queryClient);

  return queryClient;
}

/**
 * REINTENTOS (no intentos) ante errores que sí pueden ceder: 1 reintento = 2
 * intentos totales. `failureCount` es 0-based —la misma semántica que el
 * `retry: N` numérico de React Query, donde N es la cantidad de reintentos—.
 */
const MAX_QUERY_RETRIES = 1;

/**
 * W5 del verify: `new QueryClient()` pelado reintenta 3 veces —4 intentos
 * reales, medidos—. Cada reintento nace con un `config` de axios NUEVO, así
 * que la marca `_retriedAfterRefresh` del interceptor arranca limpia y vuelve
 * a pedir un refresh: hasta 4 `POST /auth/refresh` en cascada por un solo
 * render. Si otra pestaña ya rotó la familia, son hasta 4 `reuse_detected` en
 * auditoría y riesgo de deslogueo espurio por revocación de familia.
 *
 * El criterio se define sobre `ApiError.statusCode` (el shape que deja el
 * normalizador de `api.ts`, con `statusCode: 0` para fallos de red):
 * - 4xx: NO se reintenta. Un 401/403/404 no se arregla insistiendo; el 401 de
 *   sesión ya tiene su propia recuperación en el interceptor de refresh.
 * - red (0) y 5xx: se reintenta UNA vez. Son fallos transitorios de verdad.
 */
function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const statusCode = (error as Partial<ApiError> | null | undefined)?.statusCode;

  if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
    return false;
  }

  return failureCount < MAX_QUERY_RETRIES;
}

/**
 * C1 del verify (CRITICAL): la caché de React Query vive tanto como la
 * pestaña, no tanto como la sesión. Con `main.tsx` creando UN cliente para
 * toda la vida del documento, el usuario A hacía logout, entraba el usuario B
 * y la pantalla de B se pintaba con los datos cacheados de A. Con login por
 * email global (un email = un tenant), A y B pueden ser de tenants DISTINTOS:
 * es una ruptura de aislamiento multi-tenant en la capa cliente.
 *
 * ── Por qué una SUSCRIPCIÓN y no un `queryClient.clear()` en el logout ──
 * Había TRES llamadores de `clearAuth()` (menú de logout, refresh fallido del
 * interceptor, bootstrap anónimo) y los tres debían purgar: un refresh
 * fallido es una sesión muerta, y la caché queda con datos de alguien que ya
 * no está autenticado. Sumar la línea en los tres sitios deja el cuarto
 * llamador futuro libre de olvidarla —y el olvido no rompe ningún test, solo
 * filtra datos—. Acá no hay línea que olvidar: purgar la caché no es un paso
 * del logout, es una CONSECUENCIA de que cambie el sujeto autenticado.
 *
 * ── Por qué la identidad y no el token ──
 * El disparador es `user.id`, no `accessToken`:
 * - rotar el token (`setToken` del refresh) es LA MISMA sesión -> no se purga,
 *   si no, cada 15 minutos se tiraría toda la caché por nada;
 * - cambiar el idioma (`setUser`) es EL MISMO usuario -> no se purga;
 * - `A -> null` (logout / sesión muerta) y `A -> B` (login encima de otra
 *   sesión) son sujetos distintos -> se purga.
 *
 * ── Por qué "dejar una identidad" y no "que la identidad cambie" (S6) ──
 * `null -> A` también es un cambio, pero NO purga: es estrenar sesión sobre
 * una caché que ya está vacía (el logout purga al SALIR, así que nunca queda
 * nada de otro usuario esperando). Purgar ahí tenía un costo medido: el
 * bootstrap hace `setToken` antes del `setAuth` —`GET /me` necesita el
 * Bearer—, ProtectedRoute abre con solo el token, y las queries protegidas
 * que salen en esa ventana se tiraban al llegar la identidad: una consulta
 * extra por cada reload (1 -> 2 `getSessions`, medido en el re-verify). Con
 * varias listas montadas a la vez —F1-WEB-USERS— se multiplica.
 *
 * La condición es entonces `previousUserId !== null`: solo se limpia lo que
 * pudo haber quedado de ALGUIEN. El caso peligroso (`A -> B` sin logout) lo
 * cubre igual, porque ahí el anterior no era null.
 *
 * Nota: `clear()` vacía el mapa de queries, pero un observer YA montado
 * conserva su último resultado hasta que se desmonte. No importa en los
 * caminos reales —el logout desmonta el árbol protegido al instante— pero
 * explica por qué esto no reemplaza a `invalidateQueries` dentro de una
 * pantalla viva.
 */
function watchSessionIdentity(queryClient: QueryClient): void {
  let previousUserId = useAuthStore.getState().user?.id ?? null;

  useAuthStore.subscribe((state) => {
    const currentUserId = state.user?.id ?? null;
    if (currentUserId === previousUserId) {
      return;
    }

    // Se DEJA una identidad (había alguien): lo cacheado es suyo y no debe
    // sobrevivirle. `null -> A` no entra acá — ver el comentario de arriba.
    const abandonaIdentidad = previousUserId !== null;
    previousUserId = currentUserId;

    if (abandonaIdentidad) {
      queryClient.clear();
    }
  });
}
