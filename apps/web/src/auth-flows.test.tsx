import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n";
import {
  changePassword,
  getMe,
  getSessions,
  login,
  logout,
  refreshSession,
  resetPassword,
  updateMyLocale,
} from "./lib/auth/api";
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
  changePassword: vi.fn(),
  getSessions: vi.fn(),
  updateMyLocale: vi.fn(),
}));

const loginMock = vi.mocked(login);
const refreshSessionMock = vi.mocked(refreshSession);
const getMeMock = vi.mocked(getMe);
const logoutMock = vi.mocked(logout);
const changePasswordMock = vi.mocked(changePassword);
const getSessionsMock = vi.mocked(getSessions);
const updateMyLocaleMock = vi.mocked(updateMyLocale);
const resetPasswordMock = vi.mocked(resetPassword);

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

  it("F1-WEB-AUTH-03/05: email sin verificar redirige a /verify-email con 'revisá tu email'", async () => {
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
      expect(router.state.location.pathname).toBe("/verify-email");
    });
    expect(await screen.findByTestId("verify-check-email")).toBeInTheDocument();
  });
});

/**
 * Gap S1 (backlog de f1-rbac) — `/accept-invitation`. El backend manda al
 * invitado un `PasswordResetToken` con TTL de 7 días y el canje es el
 * endpoint EXISTENTE `POST /auth/reset-password` (que además promueve
 * `invited -> active`). Por eso esta página comparte mutación y schema con
 * `/reset-password` — lo único propio es el copy: quien llega acá no pidió
 * recuperar nada, lo dieron de alta.
 */
describe("Gap S1 — /accept-invitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
  });

  it("con token válido define la primera password y navega a /login", async () => {
    resetPasswordMock.mockResolvedValue(undefined);
    const router = await renderRoute("/accept-invitation?token=tok-invitacion");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Definí tu contraseña"), "mi-primera-password");
    await user.click(screen.getByRole("button", { name: "Activar mi cuenta" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    // `useResetPassword` desestructura el input, así que llega con 2 args
    // exactos — sin el contexto que React Query agrega a los mutationFn
    // pasados directo (ver el test de login más arriba).
    expect(resetPasswordMock).toHaveBeenCalledWith("tok-invitacion", "mi-primera-password");
  });

  it("sin token en la URL no muestra el form: ofrece pedirle al admin que reenvíe", async () => {
    await renderRoute("/accept-invitation");

    expect(await screen.findByTestId("invitation-invalid")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar mi cuenta" })).not.toBeInTheDocument();
  });

  it("token vencido o ya usado muestra el message traducido del backend", async () => {
    resetPasswordMock.mockRejectedValue({
      statusCode: 400,
      message: "El enlace no es válido o ya venció",
      error: "Bad Request",
      code: "auth.token_invalid",
    });
    await renderRoute("/accept-invitation?token=tok-vencido");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Definí tu contraseña"), "mi-primera-password");
    await user.click(screen.getByRole("button", { name: "Activar mi cuenta" }));

    expect(await screen.findByTestId("invitation-api-error")).toHaveTextContent(
      "El enlace no es válido o ya venció",
    );
  });

  it("una password corta se corta en el cliente: nunca llega al API", async () => {
    await renderRoute("/accept-invitation?token=tok-invitacion");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Definí tu contraseña"), "corta");
    await user.click(screen.getByRole("button", { name: "Activar mi cuenta" }));

    expect(
      await screen.findByText("La contraseña debe tener al menos 12 caracteres"),
    ).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });
});

/**
 * F1-WEB-AUTH-10 — página `/profile`. El cambio de password es la parte
 * delicada: el backend mata las otras sesiones bumpeando el epoch, lo que
 * también invalida el token con el que se hizo la request. Si el front no
 * guarda el token nuevo que viene en la respuesta, el usuario se queda con un
 * token muerto en memoria.
 */
describe("F1-WEB-AUTH-10 — /profile", () => {
  const activeSessions = [
    {
      familyId: "fam-actual",
      createdAt: "2026-08-12T10:00:00.000Z",
      expiresAt: "2026-08-19T10:00:00.000Z",
      current: true,
    },
    {
      familyId: "fam-otra",
      createdAt: "2026-08-10T10:00:00.000Z",
      expiresAt: "2026-08-17T10:00:00.000Z",
      current: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
    getSessionsMock.mockResolvedValue(activeSessions);
  });

  async function fillChangePasswordForm(values: {
    current: string;
    next: string;
    confirm?: string;
  }) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Contraseña actual"), values.current);
    await user.type(screen.getByLabelText("Contraseña nueva"), values.next);
    await user.type(
      screen.getByLabelText("Repetí la contraseña nueva"),
      values.confirm ?? values.next,
    );
    return user;
  }

  it("sin sesión redirige a /login (está detrás de ProtectedRoute)", async () => {
    const router = await renderRoute("/profile");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
  });

  it("muestra los datos del usuario del store y el shell autenticado", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    await renderRoute("/profile");

    const details = await screen.findByTestId("profile-details");
    expect(within(details).getByText("Ana")).toBeInTheDocument();
    expect(within(details).getByText("ana@acme.mx")).toBeInTheDocument();
    // El AppLayout de F1-WEB-AUTH-09 envuelve la página.
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();
  });

  it("lista las sesiones activas y marca SOLO la actual como 'Esta sesión'", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    await renderRoute("/profile");

    const list = await screen.findByTestId("active-sessions");
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(list).getAllByText("Esta sesión")).toHaveLength(1);
    expect(items[0]).toHaveTextContent("Esta sesión");
    // Jamás se muestra el identificador interno de la familia.
    expect(list).not.toHaveTextContent("fam-actual");
  });

  it("cambio exitoso: guarda el token NUEVO en el store y avisa que cerró las otras sesiones", async () => {
    useAuthStore.getState().setAuth("jwt-viejo", demoUser);
    changePasswordMock.mockResolvedValue({ accessToken: "jwt-post-cambio", expiresIn: 900 });
    await renderRoute("/profile");
    await screen.findByLabelText("Contraseña actual");

    const user = await fillChangePasswordForm({
      current: "la de siempre",
      next: "brand-new-password-12",
    });
    await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(await screen.findByTestId("change-password-success")).toHaveTextContent(
      "Cerramos las otras sesiones",
    );
    // LA invariante del front: sin esto el usuario queda con un token muerto.
    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBe("jwt-post-cambio");
    });
    expect(changePasswordMock).toHaveBeenCalledWith(
      { currentPassword: "la de siempre", newPassword: "brand-new-password-12" },
      expect.anything(),
    );
  });

  it("password actual incorrecta: muestra el message traducido del backend y NO pisa el token", async () => {
    useAuthStore.getState().setAuth("jwt-viejo", demoUser);
    changePasswordMock.mockRejectedValue({
      statusCode: 401,
      message: "Correo electrónico o contraseña incorrectos",
      error: "Unauthorized",
      code: "auth.invalid_credentials",
    });
    await renderRoute("/profile");
    await screen.findByLabelText("Contraseña actual");

    const user = await fillChangePasswordForm({
      current: "la que no es",
      next: "brand-new-password-12",
    });
    await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(await screen.findByTestId("change-password-error")).toHaveTextContent(
      "Correo electrónico o contraseña incorrectos",
    );
    expect(useAuthStore.getState().accessToken).toBe("jwt-viejo");
  });

  it("confirmación que no coincide: error en vivo y NUNCA llama al API", async () => {
    useAuthStore.getState().setAuth("jwt-viejo", demoUser);
    await renderRoute("/profile");
    await screen.findByLabelText("Contraseña actual");

    const user = await fillChangePasswordForm({
      current: "la de siempre",
      next: "brand-new-password-12",
      confirm: "otra password larga",
    });
    await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(await screen.findByText("Las contraseñas no coinciden")).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("password nueva de menos de 12 caracteres: error de política y NUNCA llama al API", async () => {
    useAuthStore.getState().setAuth("jwt-viejo", demoUser);
    await renderRoute("/profile");
    await screen.findByLabelText("Contraseña actual");

    const user = await fillChangePasswordForm({ current: "la de siempre", next: "once chars" });
    await user.click(screen.getByRole("button", { name: "Cambiar contraseña" }));

    expect(
      await screen.findByText("La contraseña debe tener al menos 12 caracteres"),
    ).toBeInTheDocument();
    expect(changePasswordMock).not.toHaveBeenCalled();
  });

  it("F1-LOCALE-08: cambiar el idioma persiste en PATCH /me y actualiza el usuario del store", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser);
    updateMyLocaleMock.mockResolvedValue({ locale: "en" });
    await renderRoute("/profile");

    const selector = await screen.findByLabelText("Idioma de la interfaz");
    await userEvent.setup().selectOptions(selector, "en");

    await waitFor(() => {
      expect(updateMyLocaleMock).toHaveBeenCalledWith("en", expect.anything());
    });
    await waitFor(() => {
      expect(useAuthStore.getState().user?.locale).toBe("en");
    });
  });
});
