import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n";
import { getMe, login, logout, refreshSession } from "./lib/auth/api";
import { __resetSessionBootstrapForTests } from "./lib/auth/session-bootstrap";
import { routeTree } from "./routeTree.gen";
import { useAuthStore } from "./stores/auth.store";

vi.mock("./lib/auth/api", () => ({
  login: vi.fn(),
  registerTenant: vi.fn(),
  verifyEmail: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  refreshSession: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
}));

const loginMock = vi.mocked(login);
const refreshSessionMock = vi.mocked(refreshSession);
const getMeMock = vi.mocked(getMe);
const logoutMock = vi.mocked(logout);

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
    __resetSessionBootstrapForTests();
    // Default: no hay cookie de refresh viva — el bootstrap cae a "anonymous".
    // Los tests de reload con sesión pisan este mock con un resolve.
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
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

  it("Bootstrap: recargar con cookie viva mantiene /dashboard y rehidrata la sesión completa", async () => {
    refreshSessionMock.mockResolvedValue({ accessToken: "jwt-revivido", expiresIn: 900 });
    getMeMock.mockResolvedValue(demoUser);

    const router = await renderRoute("/dashboard");

    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(useAuthStore.getState().accessToken).toBe("jwt-revivido");
    expect(useAuthStore.getState().user).toEqual(demoUser);
  });

  it("Bootstrap: mientras el refresh está en vuelo muestra carga y NO redirige (sin flash de /login)", async () => {
    // Refresh que nunca resuelve: congela el bootstrap en "pending".
    refreshSessionMock.mockReturnValue(new Promise(() => {}));

    const router = await renderRoute("/dashboard");

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(screen.queryByTestId("dashboard-title")).not.toBeInTheDocument();
  });

  it("F1-WEB-AUTH-09: layout autenticado con sidebar de navegación y el user en el header", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);

    await renderRoute("/dashboard");

    const nav = await screen.findByRole("navigation", { name: "Navegación principal" });
    expect(within(nav).getByText("Panel")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ana" })).toBeInTheDocument();
    // El nav placeholder de F0 ya no existe en las vistas autenticadas.
    expect(screen.queryByRole("link", { name: "Inicio" })).not.toBeInTheDocument();
  });

  it("F1-WEB-AUTH-09: el toggle colapsa el sidebar y lo anuncia con aria-expanded", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    await renderRoute("/dashboard");
    const user = userEvent.setup();

    const toggle = await screen.findByRole("button", { name: "Abrir o cerrar el menú" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(within(nav).queryByText("Panel")).not.toBeInTheDocument();
  });

  it("F1-WEB-AUTH-11: logout revoca en el backend, limpia el store y navega a /login", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    logoutMock.mockResolvedValue(undefined);
    const router = await renderRoute("/dashboard");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ana" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(logoutMock).toHaveBeenCalled();
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("F1-WEB-AUTH-11: si POST /auth/logout falla (red caída), igual limpia la sesión local y sale", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    logoutMock.mockRejectedValue({
      statusCode: 0,
      message: "Network Error",
      error: "Network Error",
    });
    const router = await renderRoute("/dashboard");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Ana" }));
    await user.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it("el nav placeholder de F0 tampoco aparece en las páginas de auth", async () => {
    await renderRoute("/login");

    await screen.findByRole("button", { name: "Entrar" });
    expect(screen.queryByRole("link", { name: "Inicio" })).not.toBeInTheDocument();
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
