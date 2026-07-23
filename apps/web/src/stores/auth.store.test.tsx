import { act, render, screen } from "@testing-library/react";
import { useAuthStore } from "./auth.store";

function TokenReader() {
  const token = useAuthStore((state) => state.accessToken);
  return <p data-testid="token">{token ?? "sin token"}</p>;
}

describe("useAuthStore", () => {
  beforeEach(() => {
    useAuthStore.getState().clearToken();
  });

  it("arranca sin token", () => {
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("setea y limpia el token", () => {
    useAuthStore.getState().setToken("jwt-demo");
    expect(useAuthStore.getState().accessToken).toBe("jwt-demo");

    useAuthStore.getState().clearToken();
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("un componente lee y reacciona al token", () => {
    render(<TokenReader />);
    expect(screen.getByTestId("token")).toHaveTextContent("sin token");

    act(() => {
      useAuthStore.getState().setToken("jwt-demo");
    });
    expect(screen.getByTestId("token")).toHaveTextContent("jwt-demo");
  });
});
