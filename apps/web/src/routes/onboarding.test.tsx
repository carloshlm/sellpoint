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
import { routeTree } from "../routeTree.gen";

/**
 * F1-WEB-ONBOARD-01 (tarea 01.19/01.20). Mismo arnés que
 * `system-users.test.tsx`: routeTree REAL, `createQueryClient()` (nunca
 * `new QueryClient()`), API mockeada.
 */
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
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    onboarded: false,
    ...overrides,
  };
}

function demoUser(tenant: AuthUser["tenant"]): AuthUser {
  return {
    id: "u1",
    email: "ana@acme.mx",
    firstName: "Ana",
    locale: "es",
    permissions: ["tenants:manage"],
    tenant,
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

describe("/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
  });

  it("con el negocio incompleto, renderiza el paso 1 (datos del negocio)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding");

    expect(await screen.findByLabelText("Razón social")).toBeInTheDocument();
    expect(screen.getByLabelText("RFC / RUT")).toBeInTheDocument();
    expect(screen.getByLabelText("Dirección")).toBeInTheDocument();
    expect(screen.getByLabelText("Moneda operacional")).toBeInTheDocument();
  });

  // 01.19: recarga a mitad del wizard — pedir ?step=3 con el paso 1
  // incompleto cae a 1, derivado del tenant del server (NO del state
  // pedido en la URL).
  it("recarga en ?step=3 con el paso 1 incompleto: el piso server-derivado lo hace caer a 1", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding?step=3");

    expect(await screen.findByLabelText("Razón social")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-coming-soon")).not.toBeInTheDocument();
  });

  it("Guardar y avanzar: completar el paso 1 llama PATCH /tenants/me y avanza al paso 2 SOLO en onSuccess", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));
    const updatedTenant = tenantFixture({
      legalName: "Acme SA de CV",
      taxId: "ACM010101AAA",
      address: "Av. Siempre Viva 123",
    });
    // El PATCH resuelve async — mientras está pendiente, la UI sigue en el
    // paso 1 (no navega antes de tiempo).
    let resolvePatch: (value: tenantApi.TenantBlock) => void = () => {};
    mockedTenantApi.updateMyTenant.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    mockedGetMe.mockResolvedValue(demoUser(updatedTenant));

    await renderRoute("/onboarding");
    await screen.findByLabelText("Razón social");

    await user.type(screen.getByLabelText("Razón social"), "Acme SA de CV");
    await user.type(screen.getByLabelText("RFC / RUT"), "ACM010101AAA");
    await user.type(screen.getByLabelText("Dirección"), "Av. Siempre Viva 123");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() =>
      expect(mockedTenantApi.updateMyTenant).toHaveBeenCalledWith(
        {
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
    expect(screen.getByLabelText("Razón social")).toBeInTheDocument();

    resolvePatch(updatedTenant);

    expect(await screen.findByRole("radio", { name: "Farmacia" })).toBeInTheDocument();
    expect(mockedGetMe).toHaveBeenCalledTimes(1);
  });

  it("sin sesión (accessToken && !user, ventana de bootstrap): muestra loading, no el form", async () => {
    // Token puesto directo (bypass setAuth) para simular la ventana entre
    // setToken() y setAuth() del bootstrap — mismo patrón que S6/#321.
    useAuthStore.getState().setToken("jwt-en-vuelo");

    await renderRoute("/onboarding");

    expect(screen.queryByLabelText("Razón social")).not.toBeInTheDocument();
  });

  it("con lng: 'en', el título y los labels del paso 1 se muestran en inglés", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding", "en");

    expect(await screen.findByLabelText("Legal name")).toBeInTheDocument();
    expect(screen.getByLabelText("Tax ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Operating currency")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  // F1-WEB-ONBOARD-02, criterio del tablero: "decisión guardada en
  // Tenant.template_choice (temporal)".
  function tenantWithBusinessDone(overrides: Partial<AuthUser["tenant"]> = {}) {
    return tenantFixture({
      legalName: "Acme SA de CV",
      taxId: "ACM010101AAA",
      address: "Av. Siempre Viva 123",
      ...overrides,
    });
  }

  it("con negocio completo y sin plantilla, renderiza el paso 2 (elegir plantilla)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));

    await renderRoute("/onboarding?step=2");

    expect(await screen.findByRole("radio", { name: "Farmacia" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Ferretería" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Abarrotes" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Personalizado" })).toBeInTheDocument();
  });

  it("Elegir plantilla: completar el paso 2 llama PATCH /tenants/me con template_choice y avanza al paso 3 SOLO en onSuccess", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));
    const updatedTenant = tenantWithBusinessDone({ templateChoice: "pharmacy" });
    let resolvePatch: (value: tenantApi.TenantBlock) => void = () => {};
    mockedTenantApi.updateMyTenant.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    mockedGetMe.mockResolvedValue(demoUser(updatedTenant));

    await renderRoute("/onboarding?step=2");
    await user.click(await screen.findByRole("radio", { name: "Farmacia" }));
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() =>
      expect(mockedTenantApi.updateMyTenant).toHaveBeenCalledWith(
        { templateChoice: "pharmacy" },
        expect.anything(),
      ),
    );
    // Todavía no navegó: el PATCH sigue pendiente.
    expect(screen.getByRole("radio", { name: "Farmacia" })).toBeInTheDocument();

    resolvePatch(updatedTenant);

    expect(await screen.findByTestId("onboarding-coming-soon")).toBeInTheDocument();
    expect(mockedGetMe).toHaveBeenCalledTimes(1);
  });

  // Nota de la tarea 01 (steps.ts): con `template_choice` persistido, la
  // derivación debe reconocer el paso 2 completo y retomar en el 3 al
  // recargar — YA NO saltar directo a 4 (F1-WEB-ONBOARD-03 aún no existe).
  // Mismo patrón que "recarga en ?step=3 con paso1 incompleto cae a 1"
  // (01.19): se pide un paso por delante del piso server-derivado y el piso
  // gana.
  it("recarga en ?step=4 con negocio y plantilla completos: el piso server-derivado lo hace caer a 3", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt-demo", demoUser(tenantWithBusinessDone({ templateChoice: "grocery" })));

    await renderRoute("/onboarding?step=4");

    expect(await screen.findByTestId("onboarding-coming-soon")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Abarrotes" })).not.toBeInTheDocument();
  });

  it("con lng: 'en', las plantillas del paso 2 se muestran en inglés", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));

    await renderRoute("/onboarding?step=2", "en");

    expect(await screen.findByRole("radio", { name: "Pharmacy" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Hardware store" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Grocery" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Custom" })).toBeInTheDocument();
  });
});
