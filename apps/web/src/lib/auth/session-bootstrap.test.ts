import { getMe, refreshSession } from "@/lib/auth/api";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import {
  __resetSessionBootstrapForTests,
  bootstrapSession,
  useSessionStore,
} from "./session-bootstrap";

vi.mock("@/lib/auth/api", () => ({
  refreshSession: vi.fn(),
  getMe: vi.fn(),
}));

const refreshSessionMock = vi.mocked(refreshSession);
const getMeMock = vi.mocked(getMe);

const demoUser = {
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es" as const,
  permissions: ["products:read"],
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
    usesLocations: false,
  },
};

describe("bootstrapSession (bootstrap de sesión tras reload)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
  });

  it("cookie viva: refresh → GET /me → sesión completa y status authenticated", async () => {
    refreshSessionMock.mockResolvedValue({ accessToken: "jwt-revivido", expiresIn: 900 });
    getMeMock.mockResolvedValue(demoUser);

    await bootstrapSession();

    expect(useAuthStore.getState().accessToken).toBe("jwt-revivido");
    expect(useAuthStore.getState().user).toEqual(demoUser);
    expect(useSessionStore.getState().status).toBe("authenticated");
  });

  it("refresh falla (sin cookie o familia revocada): sesión limpia y status anonymous", async () => {
    refreshSessionMock.mockRejectedValue({ statusCode: 401 });

    await bootstrapSession();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe("anonymous");
    expect(getMeMock).not.toHaveBeenCalled();
  });

  it("GET /me falla tras el refresh: no deja sesión a medias (token sin user)", async () => {
    vi.useFakeTimers();
    refreshSessionMock.mockResolvedValue({ accessToken: "jwt-revivido", expiresIn: 900 });
    getMeMock.mockRejectedValue({ statusCode: 500 });

    const enCurso = bootstrapSession();
    await vi.runAllTimersAsync();
    await enCurso;

    // Lo que este test SIEMPRE protegió: nunca un token sin usuario —
    // ProtectedRoute renderizaría la app sin saber quién es.
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    // ⚠ El estado cambió (2026-08-31): un 500 es un fallo TEMPORAL del
    // backend, no una sesión muerta. Antes mandaba al login; ahora deja
    // "no disponible" y la cookie intacta para reintentar.
    expect(useSessionStore.getState().status).toBe("unavailable");
    vi.useRealTimers();
  });

  it("single-flight: llamadas concurrentes (StrictMode monta efectos 2 veces) comparten UN refresh", async () => {
    refreshSessionMock.mockResolvedValue({ accessToken: "jwt-revivido", expiresIn: 900 });
    getMeMock.mockResolvedValue(demoUser);

    await Promise.all([bootstrapSession(), bootstrapSession(), bootstrapSession()]);

    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
    expect(getMeMock).toHaveBeenCalledTimes(1);
  });

  it("token ya en memoria (navegación en caliente, no reload): no toca la red", async () => {
    useAuthStore.getState().setAuth("jwt-vivo", demoUser);

    await bootstrapSession();

    expect(refreshSessionMock).not.toHaveBeenCalled();
    expect(getMeMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("jwt-vivo");
  });

  /**
   * ── UN 429 NO ES UNA SESIÓN MUERTA (Carlos, 2026-08-31) ──────────────
   *
   * Carlos, CON la sesión iniciada, recargó unas quince veces en quince
   * segundos y acabó en el login con «Demasiados intentos». Su cookie de
   * refresh seguía viva: lo que pasó es que el `catch` de este bootstrap era
   * CIEGO y trataba igual «tu sesión murió» (401) que «vas muy rápido»
   * (429) o «el backend no responde» (5xx).
   *
   * Borrar la sesión por un límite temporal es desproporcionado: además de
   * expulsarlo, le hace perder lo que estuviera haciendo. Solo un 401
   * significa que la sesión se acabó.
   */
  it("un 429 NO borra la sesión: reintenta y, si insiste, queda «no disponible»", async () => {
    vi.useFakeTimers();
    refreshSessionMock.mockRejectedValue({ statusCode: 429, message: "Demasiados intentos" });

    const enCurso = bootstrapSession();
    await vi.runAllTimersAsync();
    await enCurso;

    expect(useSessionStore.getState().status).toBe("unavailable");
    // Y sobre todo: NO se declara anónimo, que es lo que mandaba a /login.
    expect(useSessionStore.getState().status).not.toBe("anonymous");
    // Reintentó antes de rendirse: un 429 del límite global dura segundos.
    expect(refreshSessionMock.mock.calls.length).toBeGreaterThan(1);
    vi.useRealTimers();
  });

  it("si el reintento funciona, la sesión se recupera sola", async () => {
    vi.useFakeTimers();
    refreshSessionMock
      .mockRejectedValueOnce({ statusCode: 429, message: "Demasiados intentos" })
      .mockResolvedValueOnce({ accessToken: "token-nuevo", expiresIn: 900 });
    getMeMock.mockResolvedValue(demoUser);

    const enCurso = bootstrapSession();
    await vi.runAllTimersAsync();
    await enCurso;

    expect(useSessionStore.getState().status).toBe("authenticated");
    expect(useAuthStore.getState().accessToken).toBe("token-nuevo");
    vi.useRealTimers();
  });

  it("un 401 SÍ es sesión muerta: anónimo y a login, como siempre", async () => {
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "auth.invalid_token" });

    await bootstrapSession();

    expect(useSessionStore.getState().status).toBe("anonymous");
    expect(useAuthStore.getState().accessToken).toBeNull();
    // Sin reintentos: insistir con una sesión muerta no la revive.
    expect(refreshSessionMock).toHaveBeenCalledTimes(1);
  });

  it("un fallo de RED tampoco borra la sesión", async () => {
    vi.useFakeTimers();
    refreshSessionMock.mockRejectedValue({ statusCode: 0, message: "Network Error" });

    const enCurso = bootstrapSession();
    await vi.runAllTimersAsync();
    await enCurso;

    expect(useSessionStore.getState().status).toBe("unavailable");
    vi.useRealTimers();
  });
});
