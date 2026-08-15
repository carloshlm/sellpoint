import { getMe } from "@/lib/auth/api";
import { useAuthStore } from "@/stores/auth.store";
import { resyncSession } from "./session-resync";

/**
 * F1-WEB-USERS WU6 (D3 del design — hallazgo 1 del proposal). El JWT se
 * refresca solo para el BACKEND vía el interceptor (401 token_stale); el
 * `user.permissions` del store NO se actualiza solo con eso — requiere este
 * re-sync explícito: `getMe()` + `setUser`, sin logout ni token nuevo.
 */
vi.mock("@/lib/auth/api", () => ({
  getMe: vi.fn(),
}));

const getMeMock = vi.mocked(getMe);

const demoUser = {
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es" as const,
  permissions: ["users:read"],
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: true,
  },
};

describe("resyncSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
  });

  it("llama getMe() y actualiza user.permissions en el store sin tocar el token", async () => {
    useAuthStore.getState().setAuth("jwt-viejo", demoUser);
    const refreshedUser = { ...demoUser, permissions: ["users:read", "roles:manage"] };
    getMeMock.mockResolvedValue(refreshedUser);

    await resyncSession();

    expect(getMeMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().user).toEqual(refreshedUser);
    expect(useAuthStore.getState().accessToken).toBe("jwt-viejo");
  });

  it("sin sesión previa (user null), setUser es no-op — no revive una sesión fantasma", async () => {
    getMeMock.mockResolvedValue(demoUser);

    await resyncSession();

    expect(useAuthStore.getState().user).toBeNull();
  });
});
