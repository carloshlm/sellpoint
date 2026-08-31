import { act, render, screen } from "@testing-library/react";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { useAuthStore } from "./auth.store";

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
    monthlySalesGoal: null,
  },
};

function TokenReader() {
  const token = useAuthStore((state) => state.accessToken);
  return <p data-testid="token">{token ?? "sin token"}</p>;
}

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.getState().clearAuth();
    localStorage.clear();
  });

  it("arranca sin token ni usuario", () => {
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("setToken rota el token sin tocar al usuario (es lo que hace el refresh)", () => {
    useAuthStore.getState().setAuth("jwt-viejo", demoUser);

    useAuthStore.getState().setToken("jwt-nuevo");

    expect(useAuthStore.getState().accessToken).toBe("jwt-nuevo");
    // Que `user` sobreviva es lo que evita que un refresh (cada ≤15 min) se
    // lea como cambio de identidad y purgue la caché sin motivo.
    expect(useAuthStore.getState().user).toEqual(demoUser);
  });

  // S8 del re-verify: existió un `clearToken` sin llamadores que borraba el
  // token dejando `user` — desloguear con eso NO purgaba la caché (la purga
  // mira `user.id`) y revivía el CRITICAL C1 en silencio. Se eliminó: cerrar
  // sesión tiene UNA sola puerta.
  it("no existe una forma de cerrar sesión que deje al usuario en el store", () => {
    expect("clearToken" in useAuthStore.getState()).toBe(false);
  });

  it("setAuth guarda token + usuario y clearAuth limpia ambos", () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    expect(useAuthStore.getState().accessToken).toBe("jwt-demo");
    expect(useAuthStore.getState().user).toEqual(demoUser);

    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("setUser cambia el usuario SIN tocar el token (cambio de locale en /profile)", () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);

    useAuthStore.getState().setUser({ ...demoUser, locale: "en" });

    expect(useAuthStore.getState().user?.locale).toBe("en");
    expect(useAuthStore.getState().accessToken).toBe("jwt-demo");
  });

  it("setUser sin sesión no inventa una: si no había usuario, no hay nada que actualizar", () => {
    useAuthStore.getState().setUser({ ...demoUser, locale: "en" });

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("NO persiste nada en localStorage (token solo en memoria)", () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    expect(localStorage.length).toBe(0);
  });

  it("un componente lee y reacciona al token", () => {
    render(<TokenReader />);
    expect(screen.getByTestId("token")).toHaveTextContent("sin token");

    act(() => {
      useAuthStore.getState().setAuth("jwt-demo", demoUser);
    });
    expect(screen.getByTestId("token")).toHaveTextContent("jwt-demo");
  });
});
