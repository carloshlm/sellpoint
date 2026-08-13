import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n";
import { login } from "./lib/auth/api";
import { routeTree } from "./routeTree.gen";
import { useAuthStore } from "./stores/auth.store";

vi.mock("./lib/auth/api", () => ({
  login: vi.fn(),
  registerTenant: vi.fn(),
  verifyEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

const loginMock = vi.mocked(login);

const demoUser = {
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es" as const,
  permissions: ["products:read"],
};

async function renderRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

async function fillAndSubmitLogin(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Contraseña"), password);
  await user.click(screen.getByRole("button", { name: "Entrar" }));
}

describe("Flujos de auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
  });

  it("F1-WEB-AUTH-08: /dashboard sin sesión redirige a /login", async () => {
    const router = await renderRoute("/dashboard");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(await screen.findByRole("button", { name: "Entrar" })).toBeInTheDocument();
  });

  it("F1-WEB-AUTH-08: /dashboard con sesión muestra el placeholder", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    const router = await renderRoute("/dashboard");

    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
  });

  it("F1-WEB-AUTH-03: login exitoso guarda sesión y navega a /dashboard", async () => {
    loginMock.mockResolvedValue({ accessToken: "jwt-nuevo", expiresIn: 900, user: demoUser });
    const router = await renderRoute("/login");
    await screen.findByRole("button", { name: "Entrar" });

    await fillAndSubmitLogin("ana@acme.mx", "una password larga");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard");
    });
    expect(useAuthStore.getState().accessToken).toBe("jwt-nuevo");
    expect(useAuthStore.getState().user).toEqual(demoUser);
    // React Query v5 agrega un segundo arg de contexto al mutationFn.
    expect(loginMock).toHaveBeenCalledWith(
      { email: "ana@acme.mx", password: "una password larga" },
      expect.anything(),
    );
  });

  it("F1-WEB-AUTH-03: credenciales inválidas muestran el message traducido del backend", async () => {
    loginMock.mockRejectedValue({
      statusCode: 401,
      message: "Email o contraseña incorrectos",
      error: "Unauthorized",
      code: "auth.invalid_credentials",
    });
    const router = await renderRoute("/login");
    await screen.findByRole("button", { name: "Entrar" });

    await fillAndSubmitLogin("ana@acme.mx", "password equivocada");

    expect(await screen.findByTestId("login-api-error")).toHaveTextContent(
      "Email o contraseña incorrectos",
    );
    expect(router.state.location.pathname).toBe("/login");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("F1-WEB-AUTH-03/05: email sin verificar redirige a /verify con 'revisá tu email'", async () => {
    loginMock.mockRejectedValue({
      statusCode: 403,
      message: "Tenés que verificar tu email",
      error: "Forbidden",
      code: "auth.email_not_verified",
    });
    const router = await renderRoute("/login");
    await screen.findByRole("button", { name: "Entrar" });

    await fillAndSubmitLogin("ana@acme.mx", "una password larga");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/verify");
    });
    expect(await screen.findByTestId("verify-check-email")).toBeInTheDocument();
  });
});
