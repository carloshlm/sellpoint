import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import * as authApi from "../lib/auth/api";
import { createQueryClient } from "../lib/query-client";
import * as tenantApi from "../lib/tenant/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

/**
 * El wizard de 3 pasos (Carlos, 2026-08-25): negocio → almacén → tema. Los
 * pasos de campos del catálogo y de invitar al equipo se quitaron para
 * agilizar el registro. Mismo arnés que `system-users.test.tsx`: routeTree
 * REAL, `createQueryClient()` (nunca `new QueryClient()`), API mockeada.
 */
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
}));

vi.mock("../lib/tenant/api", () => ({
  getMyTenant: vi.fn(),
  updateMyTenant: vi.fn(),
  completeOnboarding: vi.fn(),
}));

vi.mock("../lib/auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/api")>();
  return { ...actual, getMe: vi.fn() };
});

const mockedTenantApi = vi.mocked(tenantApi);
const mockedGetMe = vi.mocked(authApi.getMe);

function tenantFixture(overrides: Partial<AuthUser["tenant"]> = {}): AuthUser["tenant"] {
  return {
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
    onboarded: false,
    country: null,
    ...overrides,
  };
}

function demoUser(tenant: AuthUser["tenant"], overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ana@acme.mx",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    lastNameMaternal: null,
    locale: "es",
    permissions: ["tenants:manage"],
    tenant,
    ...overrides,
  };
}

async function renderRoute(path: string, lng?: "es" | "en") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  const i18n = createI18n();
  if (lng) {
    await i18n.changeLanguage(lng);
  }
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

function tenantWithBusinessDone(overrides: Partial<AuthUser["tenant"]> = {}) {
  return tenantFixture({
    country: "MX",
    legalName: "Acme SA de CV",
    taxId: "ACM010101AAA",
    address: "Av. Siempre Viva 123",
    ...overrides,
  });
}

describe("/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    // El piso del paso 2 depende de si ya hay almacenes. Default "ya tiene
    // uno" para que los tests de otros pasos no caigan al 2.
    vi.mocked(warehousesApi.listWarehouses).mockResolvedValue([
      { id: "w-1", name: "Central", address: null, isActive: true, deactivationBlockedBy: null },
    ]);
  });

  it("con el negocio incompleto, renderiza el paso 1 (datos del negocio)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding");

    expect(await screen.findByLabelText("Nombre legal")).toBeInTheDocument();
    expect(screen.getByLabelText("País")).toBeInTheDocument();
    expect(screen.getByLabelText("Identificación fiscal")).toBeInTheDocument();
    expect(screen.getByLabelText("Dirección")).toBeInTheDocument();
    expect(screen.getByLabelText("Moneda operacional")).toBeInTheDocument();
    // El wizard perdió dos pasos (Carlos, 2026-08-25): la cuenta es de 3.
    expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Paso 1 de 3");
  });

  /**
   * El registro ya no pide "Nombre del negocio": este campo lo nombra, y el
   * hint se lo dice al usuario ANTES de que se pregunte dónde quedó aquel
   * campo del registro.
   */
  it("el Nombre legal lleva su hint aclaratorio", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding");
    await screen.findByLabelText("Nombre legal");

    expect(screen.getByText(/También será su nombre visible/)).toBeInTheDocument();
  });

  // C1 (verify-report #357): la ruta SOLO tenía `ProtectedRoute` — cualquier
  // usuario autenticado (con o sin `tenants:manage`) veía el wizard entero.
  it("C1: sin tenants:manage, /onboarding NO muestra el wizard — muestra el panel de permiso faltante", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt-demo", demoUser(tenantFixture(), { permissions: ["products:read"] }));

    await renderRoute("/onboarding");

    expect(await screen.findByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
  });

  // W1 (verify-report #357): entrar a /onboarding SIN `?step=` retoma en el
  // paso DERIVADO del tenant, no fijo en 1. Con negocio completo y almacén
  // existente, el piso es el paso 3 (tema).
  it("W1: entrar a /onboarding SIN ?step= retoma en el paso derivado del tenant (no fijo en 1)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));

    await renderRoute("/onboarding");

    expect(await screen.findByTestId("theme-light")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
  });

  // N1 (verify-report, pasada 2): el camino REAL — `OnboardingGate` montado
  // en /dashboard redirige, y el aterrizaje es el paso derivado con la
  // búsqueda LIMPIA, no el paso 1.
  it("N1: entrar a /dashboard con el wizard a mitad de camino, el gate REAL redirige y aterriza en el paso derivado (no en 1)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));

    const router = await renderRoute("/dashboard");

    expect(await screen.findByTestId("theme-light")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/onboarding");
    expect(router.state.location.search).not.toHaveProperty("step", 1);
  });

  // 01.19: recarga a mitad del wizard — pedir ?step=3 con el paso 1
  // incompleto cae a 1, derivado del tenant del server.
  it("recarga en ?step=3 con el paso 1 incompleto: el piso server-derivado lo hace caer a 1", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding?step=3");

    expect(await screen.findByLabelText("Nombre legal")).toBeInTheDocument();
  });

  it("Guardar y avanzar: el paso 1 manda name=legalName y avanza al paso 2 SOLO en onSuccess", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));
    const updatedTenant = tenantWithBusinessDone({ name: "Acme SA de CV" });
    let resolvePatch: (value: tenantApi.TenantBlock) => void = () => {};
    mockedTenantApi.updateMyTenant.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    mockedGetMe.mockResolvedValue(demoUser(updatedTenant));

    await renderRoute("/onboarding");
    await screen.findByLabelText("Nombre legal");

    await user.selectOptions(screen.getByLabelText("País"), "MX");
    await user.type(screen.getByLabelText("Nombre legal"), "Acme SA de CV");
    await user.type(screen.getByLabelText("Identificación fiscal (RFC)"), "ACM010101AAA");
    await user.type(screen.getByLabelText("Dirección"), "Av. Siempre Viva 123");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // `name: legalName` — el registro ya no nombra al negocio, este paso sí.
    await waitFor(() =>
      expect(mockedTenantApi.updateMyTenant).toHaveBeenCalledWith(
        {
          name: "Acme SA de CV",
          country: "MX",
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
          timezone: "America/Mexico_City",
          currency: "MXN",
        },
        expect.anything(),
      ),
    );
    // Todavía no navegó: el PATCH sigue pendiente.
    expect(screen.getByLabelText("Nombre legal")).toBeInTheDocument();

    resolvePatch(updatedTenant);

    expect(await screen.findByTestId("step-warehouse")).toBeInTheDocument();
    expect(mockedGetMe).toHaveBeenCalledTimes(1);
  });

  // W2 (verify-report #357): el PATCH persistió pero el resync de /me falló —
  // se queda en el paso con el error visible, no rebota mudo.
  it("W2: si el PATCH persiste pero el resync de /me falla, se queda en el paso con un error visible (no rebota mudo)", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));
    mockedTenantApi.updateMyTenant.mockResolvedValue(tenantWithBusinessDone());
    mockedGetMe.mockRejectedValue({
      statusCode: 500,
      message: "Internal error",
      error: "Internal Server Error",
    });

    await renderRoute("/onboarding");
    await screen.findByLabelText("Nombre legal");

    await user.selectOptions(screen.getByLabelText("País"), "MX");
    await user.type(screen.getByLabelText("Nombre legal"), "Acme SA de CV");
    await user.type(screen.getByLabelText("Identificación fiscal (RFC)"), "ACM010101AAA");
    await user.type(screen.getByLabelText("Dirección"), "Av. Siempre Viva 123");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    expect(
      await screen.findByText("No pudimos guardar los datos del negocio."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre legal")).toBeInTheDocument();
  });

  it("sin sesión (accessToken && !user, ventana de bootstrap): muestra loading, no el form", async () => {
    useAuthStore.getState().setToken("jwt-en-vuelo");

    await renderRoute("/onboarding");

    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
  });

  it("con lng: 'en', el título y los labels del paso 1 se muestran en inglés", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding", "en");

    expect(await screen.findByLabelText("Legal name")).toBeInTheDocument();
    expect(screen.getByLabelText("Tax ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Operating currency")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("con negocio completo y SIN almacén, renderiza el paso 2 (tu almacén)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));
    vi.mocked(warehousesApi.listWarehouses).mockResolvedValue([]);

    await renderRoute("/onboarding");

    expect(await screen.findByTestId("step-warehouse")).toBeInTheDocument();
    expect(screen.getByTestId("wizard-step-label")).toHaveTextContent("Paso 2 de 3");
  });

  describe("el paso 3: elige un tema (Carlos, 2026-08-25)", () => {
    beforeEach(() => {
      useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));
    });

    it("muestra las CUATRO opciones con Claro preseleccionado", async () => {
      await renderRoute("/onboarding");

      expect(await screen.findByRole("radio", { name: "Claro" })).toBeChecked();
      expect(screen.getByRole("radio", { name: "Oscuro" })).not.toBeChecked();
      expect(screen.getByRole("radio", { name: "Arena" })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Uva" })).toBeInTheDocument();
      // Y el aviso de que no es una decisión definitiva.
      expect(screen.getByText(/Mi perfil/)).toBeInTheDocument();
    });

    /**
     * La segunda tanda (Carlos, 2026-08-26) NO entra al wizard: elegir tema
     * no debe volverse la parte larga del registro. El hint avisa que en
     * Mi perfil hay más opciones.
     */
    it("los temas de la segunda tanda NO aparecen en el wizard, y el hint avisa que hay más", async () => {
      await renderRoute("/onboarding");
      await screen.findByRole("radio", { name: "Claro" });

      expect(screen.getAllByRole("radio")).toHaveLength(4);
      expect(screen.queryByRole("radio", { name: "Esmeralda" })).not.toBeInTheDocument();
      expect(screen.queryByRole("radio", { name: "Cabina" })).not.toBeInTheDocument();
      expect(screen.getByText(/más opciones/)).toBeInTheDocument();
    });

    it("Terminar guarda el tema elegido y COMPLETA el onboarding, aterrizando en /dashboard", async () => {
      const user = userEvent.setup();
      const done = tenantWithBusinessDone({ theme: "grape", onboarded: true });
      mockedTenantApi.updateMyTenant.mockResolvedValue(done);
      mockedTenantApi.completeOnboarding.mockResolvedValue(done);
      mockedGetMe.mockResolvedValue(demoUser(done));

      const router = await renderRoute("/onboarding");
      await screen.findByRole("radio", { name: "Uva" });

      await user.click(screen.getByRole("radio", { name: "Uva" }));
      await user.click(screen.getByRole("button", { name: "Terminar" }));

      await waitFor(() =>
        expect(mockedTenantApi.updateMyTenant).toHaveBeenCalledWith(
          { theme: "grape" },
          expect.anything(),
        ),
      );
      await waitFor(() => expect(mockedTenantApi.completeOnboarding).toHaveBeenCalled());
      await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    });

    it("si guardar el tema falla, se queda en el paso 3 con el error y NO completa el onboarding", async () => {
      const user = userEvent.setup();
      mockedTenantApi.updateMyTenant.mockRejectedValue({
        statusCode: 500,
        message: "Internal error",
        error: "Internal Server Error",
      });

      await renderRoute("/onboarding");
      await screen.findByRole("radio", { name: "Uva" });

      await user.click(screen.getByRole("button", { name: "Terminar" }));

      expect(await screen.findByTestId("step-theme-error")).toBeInTheDocument();
      expect(mockedTenantApi.completeOnboarding).not.toHaveBeenCalled();
    });

    /**
     * La vista previa EN VIVO (Carlos, 2026-08-26): un tema se elige viendo.
     * El clic re-pinta el documento al momento, sin esperar al PATCH.
     */
    it("el clic en una muestra aplica el tema AL MOMENTO, antes de Terminar", async () => {
      const user = userEvent.setup();
      await renderRoute("/onboarding");
      await screen.findByRole("radio", { name: "Uva" });

      await user.click(screen.getByRole("radio", { name: "Uva" }));

      expect(document.documentElement.dataset.theme).toBe("grape");
      expect(mockedTenantApi.updateMyTenant).not.toHaveBeenCalled();

      await user.click(screen.getByRole("radio", { name: "Claro" }));

      expect(document.documentElement.dataset.theme).toBeUndefined();
    });

    it("con lng: 'en', el paso 3 se muestra en inglés", async () => {
      await renderRoute("/onboarding", "en");

      expect(await screen.findByRole("radio", { name: "Light" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Finish" })).toBeInTheDocument();
    });
  });

  it("con tenant.onboarded=true, navegar a /onboarding redirige a /dashboard sin mostrar el wizard", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt-demo", demoUser(tenantWithBusinessDone({ onboarded: true })));

    const router = await renderRoute("/onboarding");

    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
  });
});
