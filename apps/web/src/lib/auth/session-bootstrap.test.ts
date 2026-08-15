import { getMe, refreshSession } from "@/lib/auth/api";
import { useAuthStore } from "@/stores/auth.store";
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
  locale: "es" as const,
  permissions: ["products:read"],
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    warehouseStepSeen: false,
    onboarded: true,
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

  it("GET /me falla tras el refresh: no deja sesión a medias (token sin user) — limpia todo", async () => {
    refreshSessionMock.mockResolvedValue({ accessToken: "jwt-revivido", expiresIn: 900 });
    getMeMock.mockRejectedValue({ statusCode: 500 });

    await bootstrapSession();

    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useSessionStore.getState().status).toBe("anonymous");
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
});
