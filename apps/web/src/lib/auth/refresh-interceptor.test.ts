import axios, {
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { __resetRefreshStateForTests, installRefreshInterceptor } from "./refresh-interceptor";

/** Respuesta con el shape que axios espera de un adaptador. */
function ok(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { data, status, statusText: "OK", headers: {}, config } as AxiosResponse;
}

/** Rechazo con el shape de un AxiosError (lo que el interceptor inspecciona). */
function fail(config: InternalAxiosRequestConfig, status: number, message: string) {
  return Promise.reject(
    Object.assign(new Error(message), {
      config,
      response: ok(config, {}, status),
    }),
  );
}

/**
 * Simulador de backend: responde según la URL y cuenta las llamadas. Permite
 * demorar el refresh a propósito para que varias requests fallidas coincidan
 * EN EL TIEMPO — sin esa demora, el single-flight se "probaría" solo porque
 * las llamadas van una después de la otra, que es justo el caso fácil.
 */
function buildHarness(options?: {
  refreshFails?: boolean;
  refreshDelayMs?: number;
  alwaysUnauthorized?: boolean;
}) {
  const calls = { refresh: 0, protected: 0 };
  let tokenCounter = 0;

  const adapter: AxiosAdapter = async (config) => {
    const url = config.url ?? "";

    if (url.includes("/auth/refresh")) {
      calls.refresh += 1;
      if (options?.refreshDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.refreshDelayMs));
      }
      if (options?.refreshFails) {
        return fail(config, 401, "refresh rechazado");
      }
      tokenCounter += 1;
      return ok(config, { accessToken: `token-nuevo-${tokenCounter}`, expiresIn: 900 });
    }

    if (url.includes("/auth/login")) {
      return fail(config, 401, "credenciales inválidas");
    }

    calls.protected += 1;
    // La primera vez 401 (token vencido); tras el refresh, éxito — salvo que
    // el test pida 401 permanente para verificar que no hay bucle.
    const authHeader = String(config.headers?.Authorization ?? "");
    const tieneTokenNuevo = authHeader.includes("token-nuevo");

    if (!tieneTokenNuevo || options?.alwaysUnauthorized) {
      return fail(config, 401, "token vencido");
    }

    return ok(config, { ok: true });
  };

  const client: AxiosInstance = axios.create({ baseURL: "http://api.test", adapter });
  installRefreshInterceptor(client);
  return { client, calls };
}

describe("interceptor de refresh (F1-WEB-AUTH-02)", () => {
  beforeEach(() => {
    __resetRefreshStateForTests();
    useAuthStore.getState().clearAuth();
    useAuthStore.getState().setAuth("token-viejo", {
      id: "u1",
      email: "ana@test.com",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      locale: "es",
      permissions: [],
      subscription: SUBSCRIPTION_PLUS,
      tenant: {
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
      },
    });
  });

  it("adjunta el token del store como Bearer", async () => {
    const { client } = buildHarness();
    useAuthStore.getState().setToken("token-nuevo-manual");

    const response = await client.get("/roles");

    expect(response.config.headers.Authorization).toBe("Bearer token-nuevo-manual");
  });

  /**
   * EL TEST QUE JUSTIFICA TODO EL DISEÑO. Sin single-flight serían 3 refresh
   * concurrentes; el backend rotaría en el primero y trataría los otros dos
   * como REUSO -> revocaría la familia entera y expulsaría al usuario.
   */
  it("con 3 requests fallando a la vez, dispara UN SOLO refresh y reintenta las 3", async () => {
    const { client, calls } = buildHarness({ refreshDelayMs: 20 });

    const responses = await Promise.all([
      client.get("/roles"),
      client.get("/users"),
      client.get("/permissions"),
    ]);

    expect(calls.refresh).toBe(1);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(useAuthStore.getState().accessToken).toBe("token-nuevo-1");
  });

  it("reintenta la request original con el token NUEVO, no con el vencido", async () => {
    const { client } = buildHarness();

    const response = await client.get("/roles");

    expect(String(response.config.headers.Authorization)).toContain("token-nuevo");
  });

  it("un 401 en /auth/login NO dispara refresh: son credenciales malas, no sesión vencida", async () => {
    const { client, calls } = buildHarness();

    await expect(client.post("/auth/login", {})).rejects.toBeDefined();

    expect(calls.refresh).toBe(0);
  });

  it("no entra en bucle: si tras refrescar sigue dando 401, reintenta UNA vez y se rinde", async () => {
    const { client, calls } = buildHarness({ alwaysUnauthorized: true });

    await expect(client.get("/roles")).rejects.toBeDefined();

    expect(calls.refresh).toBe(1);
    expect(calls.protected).toBe(2); // original + un único reintento
  });

  it("si el refresh falla, limpia la sesión para que ProtectedRoute expulse a /login", async () => {
    const { client } = buildHarness({ refreshFails: true });

    await expect(client.get("/roles")).rejects.toBeDefined();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("tras un refresh fallido, una expiración posterior vuelve a intentar (no queda trabado)", async () => {
    const primero = buildHarness({ refreshFails: true });
    await expect(primero.client.get("/roles")).rejects.toBeDefined();
    expect(primero.calls.refresh).toBe(1);

    // Nueva sesión (el usuario volvió a loguearse) con otro cliente.
    useAuthStore.getState().setToken("token-viejo");
    const segundo = buildHarness();
    await expect(segundo.client.get("/roles")).resolves.toMatchObject({ status: 200 });
    expect(segundo.calls.refresh).toBe(1);
  });

  it.each([403, 429, 500])(
    "un %i no dispara refresh (no es un problema de sesión)",
    async (code) => {
      const calls = { refresh: 0 };
      const adapter: AxiosAdapter = async (config) => {
        if (String(config.url).includes("/auth/refresh")) {
          calls.refresh += 1;
          return ok(config, {});
        }
        return fail(config, code, "fallo");
      };
      const client = axios.create({ baseURL: "http://api.test", adapter });
      installRefreshInterceptor(client);

      await expect(client.get("/roles")).rejects.toBeDefined();

      expect(calls.refresh).toBe(0);
    },
  );
});

/**
 * F1-WEB-AUTH-10: `POST /auth/change-password` responde 401
 * `auth.invalid_credentials` cuando la password ACTUAL está mal. Ese 401 no
 * es "tu sesión expiró", así que refrescar y reintentar repetiría el mismo
 * intento fallido: doble verificación argon2, doble fila de auditoría y doble
 * consumo del throttle de IP (5 cada 15 min) por cada typo del usuario.
 */
describe("interceptor de refresh — 401 de credenciales vs 401 de sesión", () => {
  beforeEach(() => {
    __resetRefreshStateForTests();
    useAuthStore.getState().setAuth("token-viejo", {
      id: "u1",
      email: "ana@test.com",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      locale: "es",
      permissions: [],
      subscription: SUBSCRIPTION_PLUS,
      tenant: {
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
      },
    });
  });

  function buildCredentialHarness(code: string | undefined) {
    const calls = { refresh: 0, changePassword: 0 };

    const adapter: AxiosAdapter = async (config) => {
      const url = config.url ?? "";

      if (url.includes("/auth/refresh")) {
        calls.refresh += 1;
        return ok(config, { accessToken: "token-nuevo-1", expiresIn: 900 });
      }

      calls.changePassword += 1;
      return Promise.reject(
        Object.assign(new Error("unauthorized"), {
          config,
          response: ok(config, code ? { code } : {}, 401),
        }),
      );
    };

    const client: AxiosInstance = axios.create({ baseURL: "http://api.test", adapter });
    installRefreshInterceptor(client);
    return { client, calls };
  }

  it("401 con code auth.invalid_credentials: NO refresca ni reintenta (un solo intento)", async () => {
    const { client, calls } = buildCredentialHarness("auth.invalid_credentials");

    await expect(client.post("/auth/change-password", {})).rejects.toBeDefined();

    expect(calls.refresh).toBe(0);
    expect(calls.changePassword).toBe(1);
  });

  it("401 SIN code de credenciales (token vencido) sí refresca y reintenta una vez", async () => {
    const { client, calls } = buildCredentialHarness(undefined);

    await expect(client.post("/auth/change-password", {})).rejects.toBeDefined();

    expect(calls.refresh).toBe(1);
    expect(calls.changePassword).toBe(2);
  });

  it("401 con code auth.token_stale (epoch bumpeado) SÍ refresca: eso sí es sesión, no credenciales", async () => {
    const { client, calls } = buildCredentialHarness("auth.token_stale");

    await expect(client.get("/auth/sessions")).rejects.toBeDefined();

    expect(calls.refresh).toBe(1);
  });
});
