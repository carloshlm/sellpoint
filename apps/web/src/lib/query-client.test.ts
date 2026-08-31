import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createQueryClient } from "./query-client";

const DEMO_TENANT = {
  id: "tenant-1",
  name: "Acme",
  legalName: null,
  taxId: null,
  phone: null,
  theme: null,
  address: null,
  timezone: "America/Mexico_City",
  currency: "MXN",
  templateChoice: null,
  country: "MX",
  onboarded: true,
  sellWithoutStock: false,
  usesLocations: false,
  monthlySalesGoal: null,
} as const;

const ana: AuthUser = {
  id: "u-ana",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions: ["products:read"],
  subscription: SUBSCRIPTION_PLUS,
  tenant: DEMO_TENANT,
};

const beto: AuthUser = {
  id: "u-beto",
  email: "beto@otra-empresa.mx",
  firstName: "Beto",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions: ["products:read"],
  subscription: SUBSCRIPTION_PLUS,
  tenant: DEMO_TENANT,
};

const CACHE_KEY = ["auth", "sessions"] as const;
const DATO_DE_ANA = [{ familyId: "fam-ana", createdAt: "2026-01-15T10:00:00.000Z" }];

/**
 * C1 del verify de f1-web-auth: `main.tsx` crea UN QueryClient para toda la
 * vida de la pestaña, así que la caché sobrevive al logout. Con login por
 * email global, el usuario siguiente puede ser de OTRO tenant: la caché sucia
 * es una fuga de aislamiento multi-tenant en el cliente.
 */
describe("createQueryClient — la caché muere con la sesión (C1)", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
  });

  it("cerrar sesión (clearAuth) deja la caché vacía", () => {
    const queryClient = createQueryClient();
    useAuthStore.getState().setAuth("jwt-ana", ana);
    queryClient.setQueryData(CACHE_KEY, DATO_DE_ANA);
    expect(queryClient.getQueryData(CACHE_KEY)).toHaveLength(1);

    useAuthStore.getState().clearAuth();

    expect(queryClient.getQueryData(CACHE_KEY)).toBeUndefined();
  });

  it("si entra OTRO usuario sin logout de por medio, tampoco hereda la caché", () => {
    const queryClient = createQueryClient();
    useAuthStore.getState().setAuth("jwt-ana", ana);
    queryClient.setQueryData(CACHE_KEY, DATO_DE_ANA);

    useAuthStore.getState().setAuth("jwt-beto", beto);

    expect(queryClient.getQueryData(CACHE_KEY)).toBeUndefined();
  });

  it("rotar el access token (refresh) NO tira la caché: es la misma sesión", () => {
    const queryClient = createQueryClient();
    useAuthStore.getState().setAuth("jwt-ana", ana);
    queryClient.setQueryData(CACHE_KEY, DATO_DE_ANA);

    useAuthStore.getState().setToken("jwt-ana-rotado");

    expect(queryClient.getQueryData(CACHE_KEY)).toEqual(DATO_DE_ANA);
  });

  it("cambiar el idioma (setUser) NO tira la caché: es el mismo usuario", () => {
    const queryClient = createQueryClient();
    useAuthStore.getState().setAuth("jwt-ana", ana);
    queryClient.setQueryData(CACHE_KEY, DATO_DE_ANA);

    useAuthStore.getState().setUser({ ...ana, locale: "en" });

    expect(queryClient.getQueryData(CACHE_KEY)).toEqual(DATO_DE_ANA);
  });

  /**
   * S6 del re-verify: el bootstrap hace `setToken` (línea 54) ANTES del
   * `setAuth` (56), porque `GET /me` necesita el Bearer. En esa ventana
   * ProtectedRoute ya abre (le alcanza con el token) y las queries protegidas
   * salen; cuando llega la identidad, el `null → u1` purgaba datos recién
   * traídos -> una consulta EXTRA por cada reload. Medido: 1 → 2 `getSessions`.
   * Con F1-WEB-USERS (varias listas montadas a la vez) se multiplica.
   *
   * La regla correcta no es "purgá cuando la identidad CAMBIA" sino "purgá
   * cuando DEJÁS una identidad": estrenar sesión sobre una caché vacía no
   * necesita limpieza (el logout ya purgó al salir).
   */
  it("estrenar sesión (null → usuario) NO purga: la caché del arranque es de este usuario", () => {
    const queryClient = createQueryClient();
    // El arranque real: token primero (para que `GET /me` lleve Bearer), y en
    // esa ventana ya salen queries protegidas que llenan la caché.
    useAuthStore.getState().setToken("jwt-ana");
    queryClient.setQueryData(CACHE_KEY, DATO_DE_ANA);

    // Llega la identidad: es el MISMO usuario que pidió esos datos.
    useAuthStore.getState().setAuth("jwt-ana", ana);

    expect(queryClient.getQueryData(CACHE_KEY)).toEqual(DATO_DE_ANA);
  });

  it("cada cliente vigila su propia caché: dos pestañas no se pisan", () => {
    const primero = createQueryClient();
    const segundo = createQueryClient();
    useAuthStore.getState().setAuth("jwt-ana", ana);
    primero.setQueryData(CACHE_KEY, DATO_DE_ANA);
    segundo.setQueryData(CACHE_KEY, DATO_DE_ANA);

    useAuthStore.getState().clearAuth();

    expect(primero.getQueryData(CACHE_KEY)).toBeUndefined();
    expect(segundo.getQueryData(CACHE_KEY)).toBeUndefined();
  });
});

/**
 * GUARDARRAÍL DEL PUNTO DE ENTRADA. Todo lo de arriba prueba la factory, no la
 * app: si `main.tsx` vuelve a un `new QueryClient()` pelado, la suite entera
 * sigue verde y producción se queda otra vez sin defaults ni purga de caché.
 * Ese es EXACTAMENTE el modo de falla que dejó pasar C1 y W5 — el arnés y la
 * app divergieron sin que nada gritara. Acá grita.
 */
describe("main.tsx usa la factory, no un QueryClient pelado", () => {
  const main = readFileSync(join(__dirname, "../main.tsx"), "utf-8");

  it("construye el cliente con createQueryClient()", () => {
    expect(main).toMatch(/createQueryClient\(\)/);
  });

  it("no instancia QueryClient a mano", () => {
    expect(main).not.toMatch(/new QueryClient\(/);
  });
});

/**
 * W5 del verify: `new QueryClient()` pelado reintenta 3 veces (4 intentos
 * reales, medido). Cada reintento nace con un config nuevo, así que el guard
 * `_retriedAfterRefresh` del interceptor arranca limpio y dispara hasta 4
 * `POST /auth/refresh` en cascada -> hasta 4 filas `reuse_detected` y riesgo
 * de deslogueo espurio por revocación de familia.
 */
describe("createQueryClient — política de reintentos (W5)", () => {
  async function contarIntentos(error: unknown): Promise<number> {
    const queryClient = createQueryClient();
    let intentos = 0;

    await expect(
      queryClient.fetchQuery({
        queryKey: ["probe", Math.random()],
        queryFn: () => {
          intentos += 1;
          return Promise.reject(error);
        },
        retryDelay: 0,
      }),
    ).rejects.toBeDefined();

    return intentos;
  }

  it("un 401 se intenta UNA sola vez: reintentar no arregla credenciales", async () => {
    expect(await contarIntentos({ statusCode: 401, message: "no", error: "Unauthorized" })).toBe(1);
  });

  it("un 404 tampoco se reintenta: el recurso no va a aparecer solo", async () => {
    expect(await contarIntentos({ statusCode: 404, message: "no", error: "Not Found" })).toBe(1);
  });

  it("un 500 SÍ se reintenta, pero poco", async () => {
    expect(await contarIntentos({ statusCode: 500, message: "no", error: "Server Error" })).toBe(2);
  });

  it("un fallo de red (statusCode 0 del normalizador de api.ts) SÍ se reintenta", async () => {
    expect(
      await contarIntentos({ statusCode: 0, message: "Network Error", error: "Network Error" }),
    ).toBe(2);
  });
});
