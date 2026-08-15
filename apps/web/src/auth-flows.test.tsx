import type { QueryClient } from "@tanstack/react-query";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "./i18n";
import {
  changePassword,
  forgotPassword,
  getMe,
  getSessions,
  login,
  logout,
  refreshSession,
  registerTenant,
  resetPassword,
  updateMyLocale,
  verifyEmail,
} from "./lib/auth/api";
import { SESSIONS_QUERY_KEY } from "./lib/auth/hooks";
import { __resetSessionBootstrapForTests } from "./lib/auth/session-bootstrap";
import { createQueryClient } from "./lib/query-client";
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
const registerTenantMock = vi.mocked(registerTenant);
const verifyEmailMock = vi.mocked(verifyEmail);
const forgotPasswordMock = vi.mocked(forgotPassword);

// F1-WEB-ONBOARD-01: tenant ya onboarded — estos flujos son de auth/perfil,
// fuera del alcance del wizard; OnboardingGate no debe interceptarlos.
const DEMO_TENANT = {
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
} as const;

const demoUser = {
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es" as const,
  permissions: ["products:read"],
  tenant: DEMO_TENANT,
};

/**
 * `queryClient` es un parámetro a propósito: la app monta UN solo cliente por
 * pestaña (`main.tsx`) y un arnés que crea uno nuevo en cada render aísla por
 * construcción justo lo que producción comparte — así fue como C1 (caché
 * sucia tras el logout) se escapó de esta suite. Los tests que ejercitan la
 * vida de la caché entre sesiones pasan el MISMO cliente en las dos fases.
 */
async function renderRoute(path: string, queryClient: QueryClient = createQueryClient()) {
  // D3: `readTokenFromUrl` lee `window.location` de VERDAD (no el estado del
  // router en memoria) — sincronizamos la URL real de jsdom con el path que
  // se está "navegando" en el test, igual que hace un browser real cuando
  // TanStack Router usa `createBrowserHistory`.
  window.history.pushState(null, "", path);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={queryClient}>
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
 * W1 del verify f1-web-auth: estas cuatro páginas estaban implementadas y
 * desplegadas, pero NINGÚN test las renderizaba — los mocks de
 * registerTenant, verifyEmail y forgotPassword llevaban declarados sin uso
 * desde el primer batch. Es la clase de hueco que ya costó un bug real: el
 * mail de producción apuntaba a `/verify-email` cuando la única ruta era
 * `/verify`, y ningún test podía verlo porque ninguno pasaba por la URL.
 * Acá se cubre el criterio "Verificar:" del tablero de cada página.
 */
describe("F1-WEB-AUTH-04 — /register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
  });

  async function fillRegisterForm(overrides: { email?: string; password?: string } = {}) {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Nombre del negocio"), "Ferretería El Tornillo");
    await user.type(screen.getByLabelText("Nombre"), "Ana");
    await user.type(screen.getByLabelText("Apellido paterno"), "García");
    await user.type(screen.getByLabelText("Email"), overrides.email ?? "ana@acme.mx");
    await user.type(
      screen.getByLabelText("Contraseña"),
      overrides.password ?? "una-password-de-doce",
    );
    return user;
  }

  it("registro exitoso muestra 'revisá tu email' con el email enviado", async () => {
    registerTenantMock.mockResolvedValue({ tenantId: "t1", userId: "u1" });
    await renderRoute("/register");
    await screen.findByRole("button", { name: "Crear cuenta" });

    const user = await fillRegisterForm();
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByTestId("register-success")).toHaveTextContent(
      "Te mandamos un enlace a ana@acme.mx",
    );
    // El apellido materno vacío viaja como undefined (el schema lo normaliza)
    // y el locale sale del idioma de la UI, no del navegador.
    expect(registerTenantMock).toHaveBeenCalledWith(
      {
        tenantName: "Ferretería El Tornillo",
        firstName: "Ana",
        lastNamePaternal: "García",
        lastNameMaternal: undefined,
        email: "ana@acme.mx",
        password: "una-password-de-doce",
        locale: "es",
      },
      expect.anything(),
    );
  });

  it("la política de password se valida EN VIVO: el error aparece al tipear y el submit no llama al API", async () => {
    await renderRoute("/register");
    await screen.findByRole("button", { name: "Crear cuenta" });

    const user = await fillRegisterForm({ password: "corta" });

    // mode: "onChange" — el error tiene que estar visible SIN submit.
    expect(
      await screen.findByText("La contraseña debe tener al menos 12 caracteres"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(registerTenantMock).not.toHaveBeenCalled();
  });

  it("un email inválido muestra el error de validación y nunca llama al API", async () => {
    await renderRoute("/register");
    await screen.findByRole("button", { name: "Crear cuenta" });

    const user = await fillRegisterForm({ email: "esto-no-es-un-email" });
    await user.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Ingresá un email válido")).toBeInTheDocument();
    expect(registerTenantMock).not.toHaveBeenCalled();
  });
});

describe("F1-WEB-AUTH-05 — /verify-email consume el token de la URL", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
  });

  it("con token en la URL lo canjea contra el API una sola vez y muestra el éxito", async () => {
    verifyEmailMock.mockResolvedValue(undefined);
    await renderRoute("/verify-email?token=tok-verificacion");

    expect(await screen.findByTestId("verify-success")).toBeInTheDocument();
    // El token es de UN solo uso: un doble disparo lo quemaría en vano.
    expect(verifyEmailMock).toHaveBeenCalledTimes(1);
    expect(verifyEmailMock).toHaveBeenCalledWith("tok-verificacion", expect.anything());
  });

  it("token inválido o vencido muestra el message del backend y la salida a registrarse", async () => {
    verifyEmailMock.mockRejectedValue({
      statusCode: 400,
      message: "El enlace no es válido o ya venció",
      error: "Bad Request",
      code: "auth.token_invalid",
    });
    await renderRoute("/verify-email?token=tok-vencido");

    expect(await screen.findByTestId("verify-error")).toHaveTextContent(
      "El enlace no es válido o ya venció",
    );
    expect(screen.getByRole("link", { name: "Volver a registrarme" })).toBeInTheDocument();
  });

  // D3 (#347): el link NUEVO que manda el backend usa `#token=`, no `?token=`.
  it("D3: con el token en el FRAGMENTO (#token=, link nuevo) lo canjea igual", async () => {
    verifyEmailMock.mockResolvedValue(undefined);
    await renderRoute("/verify-email#token=tok-fragmento");

    expect(await screen.findByTestId("verify-success")).toBeInTheDocument();
    expect(verifyEmailMock).toHaveBeenCalledWith("tok-fragmento", expect.anything());
  });

  it("D3: tras leer el token de la URL, la barra de direcciones queda limpia (no reintroduce el secreto)", async () => {
    verifyEmailMock.mockResolvedValue(undefined);
    await renderRoute("/verify-email#token=tok-fragmento");

    await screen.findByTestId("verify-success");
    expect(window.location.hash).toBe("");
  });
});

describe("F1-WEB-AUTH-06 — /forgot-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
  });

  it("enviar el email muestra 'revisá tu email' sin revelar si la cuenta existe (202 anti-enumeración)", async () => {
    forgotPasswordMock.mockResolvedValue(undefined);
    await renderRoute("/forgot-password");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Email"), "ana@acme.mx");
    await user.click(screen.getByRole("button", { name: "Enviar enlace" }));

    // El copy es condicional a propósito: mismo mensaje exista o no la cuenta.
    expect(await screen.findByTestId("forgot-success")).toHaveTextContent(
      "Si ana@acme.mx está registrado, te va a llegar un enlace",
    );
    expect(forgotPasswordMock).toHaveBeenCalledWith("ana@acme.mx", expect.anything());
  });
});

describe("F1-WEB-AUTH-07 — /reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
  });

  it("con token y password nueva válida llama al API y navega a /login", async () => {
    resetPasswordMock.mockResolvedValue(undefined);
    const router = await renderRoute("/reset-password?token=tok-reset");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Nueva contraseña"), "password-nueva-larga");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    // `useResetPassword` desestructura el input: exactamente (token, password).
    expect(resetPasswordMock).toHaveBeenCalledWith("tok-reset", "password-nueva-larga");
  });

  it("una password de menos de 12 caracteres se corta en el cliente: nunca llega al API", async () => {
    await renderRoute("/reset-password?token=tok-reset");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Nueva contraseña"), "corta");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    expect(
      await screen.findByText("La contraseña debe tener al menos 12 caracteres"),
    ).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  // D3 (#347): el link NUEVO que manda el backend usa `#token=`, no `?token=`.
  it("D3: con el token en el FRAGMENTO (#token=, link nuevo) funciona igual", async () => {
    resetPasswordMock.mockResolvedValue(undefined);
    const router = await renderRoute("/reset-password#token=tok-fragmento");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Nueva contraseña"), "password-nueva-larga");
    await user.click(screen.getByRole("button", { name: "Guardar contraseña" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(resetPasswordMock).toHaveBeenCalledWith("tok-fragmento", "password-nueva-larga");
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

  // D3 (#347): el link NUEVO que manda el backend usa `#token=`, no `?token=`.
  it("D3: con el token en el FRAGMENTO (#token=, link nuevo) acepta la invitación igual", async () => {
    resetPasswordMock.mockResolvedValue(undefined);
    const router = await renderRoute("/accept-invitation#token=tok-fragmento");
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Definí tu contraseña"), "mi-primera-password");
    await user.click(screen.getByRole("button", { name: "Activar mi cuenta" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
    });
    expect(resetPasswordMock).toHaveBeenCalledWith("tok-fragmento", "mi-primera-password");
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

/**
 * C1 del verify de f1-web-auth (CRITICAL). El logout limpiaba el store de
 * Zustand y NADA más: la caché de React Query vive tanto como la pestaña, no
 * tanto como la sesión. El usuario siguiente en la misma pestaña se comía los
 * datos cacheados del anterior — y con login por email global (un email = un
 * tenant) pueden ser de tenants DISTINTOS.
 *
 * Estos dos tests comparten UN solo `QueryClient` entre las dos sesiones, que
 * es la topología real de `main.tsx`.
 */
describe("C1 — la caché de React Query muere con la sesión", () => {
  const sesionesDeAna = [
    {
      familyId: "fam-ana-1",
      createdAt: "2026-01-15T10:00:00.000Z",
      expiresAt: "2026-01-22T10:00:00.000Z",
      current: true,
    },
    {
      familyId: "fam-ana-2",
      createdAt: "2026-01-10T10:00:00.000Z",
      expiresAt: "2026-01-17T10:00:00.000Z",
      current: false,
    },
  ];

  const beto = {
    id: "u2",
    email: "beto@otra-empresa.mx",
    firstName: "Beto",
    locale: "es" as const,
    permissions: ["products:read"],
    tenant: DEMO_TENANT,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    __resetSessionBootstrapForTests();
    refreshSessionMock.mockRejectedValue({ statusCode: 401, message: "", error: "Unauthorized" });
    logoutMock.mockResolvedValue(undefined);
  });

  async function logoutPorElMenu(nombre: string) {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: nombre }));
    await user.click(await screen.findByRole("menuitem", { name: "Cerrar sesión" }));
    await waitFor(() => {
      expect(useAuthStore.getState().accessToken).toBeNull();
    });
  }

  it("el logout vacía la caché en el acto, sin disparar un refetch de despedida", async () => {
    const queryClient = createQueryClient();
    useAuthStore.getState().setAuth("jwt-ana", demoUser);
    getSessionsMock.mockResolvedValue(sesionesDeAna);
    await renderRoute("/profile", queryClient);
    await screen.findByTestId("active-sessions");
    // Precondición real: la caché quedó poblada con las 2 sesiones de Ana.
    expect(queryClient.getQueryData(SESSIONS_QUERY_KEY)).toHaveLength(2);
    const fetchsAntesDelLogout = getSessionsMock.mock.calls.length;

    await logoutPorElMenu("Ana");

    expect(queryClient.getQueryData(SESSIONS_QUERY_KEY)).toBeUndefined();
    // Purgar no puede degenerar en "refetch con la sesión ya muerta": ese
    // request saldría sin token, daría 401 y dispararía el interceptor de
    // refresh contra una familia recién revocada.
    expect(getSessionsMock.mock.calls.length).toBe(fetchsAntesDelLogout);
  });

  it("el usuario siguiente en la misma pestaña NO ve las sesiones del anterior", async () => {
    const queryClient = createQueryClient();

    // --- Usuario A: entra a /profile y su lista de sesiones se cachea -------
    useAuthStore.getState().setAuth("jwt-ana", demoUser);
    getSessionsMock.mockResolvedValue(sesionesDeAna);
    await renderRoute("/profile", queryClient);
    const listaDeAna = await screen.findByTestId("active-sessions");
    expect(within(listaDeAna).getAllByRole("listitem")).toHaveLength(2);

    await logoutPorElMenu("Ana");
    cleanup();

    // --- Usuario B: otro tenant, MISMA pestaña, su fetch queda colgado -----
    // Colgado a propósito: si la caché sobrevivió, React Query pinta el dato
    // viejo AL INSTANTE mientras refetchea (staleTime 0) — que es justo lo
    // que reportó el verify.
    getSessionsMock.mockReturnValue(new Promise(() => {}));
    useAuthStore.getState().setAuth("jwt-beto", beto);
    await renderRoute("/profile", queryClient);

    // La página de B se renderizó de verdad (si no, lo de abajo no probaría nada).
    expect(await screen.findByTestId("profile-details")).toHaveTextContent("beto@otra-empresa.mx");
    expect(screen.queryByTestId("active-sessions")).not.toBeInTheDocument();
    expect(screen.getByText("Cargando tus sesiones…")).toBeInTheDocument();
  });
});
