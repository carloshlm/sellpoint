import { act, render, screen } from "@testing-library/react";
import { useAuthStore } from "./auth.store";

const demoUser = {
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es" as const,
  permissions: ["products:read"],
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

  it("setea y limpia el token", () => {
    useAuthStore.getState().setToken("jwt-demo");
    expect(useAuthStore.getState().accessToken).toBe("jwt-demo");

    useAuthStore.getState().clearToken();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("setAuth guarda token + usuario y clearAuth limpia ambos", () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    expect(useAuthStore.getState().accessToken).toBe("jwt-demo");
    expect(useAuthStore.getState().user).toEqual(demoUser);

    useAuthStore.getState().clearAuth();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
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
