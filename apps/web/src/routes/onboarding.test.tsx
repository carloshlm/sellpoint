import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import * as authApi from "../lib/auth/api";
import * as catalogsApi from "../lib/catalogs/api";
import { createQueryClient } from "../lib/query-client";
import * as rbacApi from "../lib/rbac/api";
import * as tenantApi from "../lib/tenant/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

/**
 * F1-WEB-ONBOARD-01 (tarea 01.19/01.20). Mismo arnés que
 * `system-users.test.tsx`: routeTree REAL, `createQueryClient()` (nunca
 * `new QueryClient()`), API mockeada.
 */
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
}));

vi.mock("../lib/catalogs/api", () => ({
  listCatalogs: vi.fn(),
  listFields: vi.fn(),
  createField: vi.fn(),
  createCatalog: vi.fn(),
  updateCatalog: vi.fn(),
  updateField: vi.fn(),
  removeField: vi.fn(),
  listRecords: vi.fn(),
  listLookupOptions: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
}));

vi.mock("../lib/tenant/api", () => ({
  getMyTenant: vi.fn(),
  updateMyTenant: vi.fn(),
  completeOnboarding: vi.fn(),
}));

// F1-WEB-ONBOARD-04: el paso 4 reusa `useRoles()`/`useCreateUser()`
// (lib/rbac/hooks.ts) — mismo mock parcial que `system-users.test.tsx`,
// SOLO los fetchers que el wizard toca.
vi.mock("../lib/rbac/api", () => ({
  listRoles: vi.fn(),
  createUser: vi.fn(),
}));

vi.mock("../lib/auth/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/auth/api")>();
  return { ...actual, getMe: vi.fn() };
});

const mockedTenantApi = vi.mocked(tenantApi);
const mockedRbacApi = vi.mocked(rbacApi);
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
    // Ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md §2): sin país, como
    // cualquier otro campo del paso 1 todavía sin completar.
    country: null,
    ...overrides,
  };
}

function demoUser(tenant: AuthUser["tenant"], overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ana@acme.mx",
    firstName: "Ana",
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

const ROLES: rbacApi.RoleSummary[] = [
  { id: "r1", name: "Cajero", permissionCodes: ["sales:read"], userCount: 2 },
  { id: "r2", name: "Admin", permissionCodes: ["users:manage"], userCount: 1 },
];

describe("/onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedRbacApi.listRoles.mockResolvedValue(ROLES);
    // F2-ONBOARD-03: el piso del paso 3 depende de si ya hay almacenes.
    // Default "ya tiene uno" para que los tests de otros pasos no caigan al 3.
    vi.mocked(warehousesApi.listWarehouses).mockResolvedValue([
      { id: "w-1", name: "Central", address: null, isActive: true },
    ]);
    vi.mocked(catalogsApi.listCatalogs).mockResolvedValue([
      {
        id: "cat-products",
        name: "Catálogo de Productos",
        systemKey: "products",
        isSystem: true,
        isActive: true,
      },
    ]);
    vi.mocked(catalogsApi.listFields).mockResolvedValue([]);
  });

  it("con el negocio incompleto, renderiza el paso 1 (datos del negocio)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding");

    expect(await screen.findByLabelText("Nombre legal")).toBeInTheDocument();
    // Ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md §2): "RFC / RUT" murió —
    // sin país elegido, la etiqueta fiscal es la genérica sin sigla.
    expect(screen.getByLabelText("País")).toBeInTheDocument();
    expect(screen.getByLabelText("Identificación fiscal")).toBeInTheDocument();
    expect(screen.getByLabelText("Dirección")).toBeInTheDocument();
    expect(screen.getByLabelText("Moneda operacional")).toBeInTheDocument();
  });

  // C1 (verify-report #357): la ruta SOLO tenía `ProtectedRoute` — cualquier
  // usuario autenticado (con o sin `tenants:manage`) veía el wizard entero.
  // `OnboardingGate` no cubre este caso a propósito (A2, no monta acá): la
  // ruta misma debe cortar por permiso. Repro exacto del verify: un usuario
  // con solo `products:read` entrando a mano a `/onboarding`.
  it("C1: sin tenants:manage, /onboarding NO muestra el wizard — muestra el panel de permiso faltante", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt-demo", demoUser(tenantFixture(), { permissions: ["products:read"] }));

    await renderRoute("/onboarding");

    expect(await screen.findByText("No tienes permiso para ver esta sección.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
  });

  // W1 (verify-report #357): entrar a /onboarding SIN `?step=` (el caso del
  // `OnboardingGate`, que redirige sin pedir un paso puntual) debía aterrizar
  // en el paso DERIVADO del tenant, no fijo en 1. Antes: `clampStep(undefined)`
  // devolvía 1 y `effectiveStep = min(1, piso)` solo podía bajar, nunca subir
  // — un tenant con el paso 1 ya completo volvía a ver el form del paso 1.
  it("W1: entrar a /onboarding SIN ?step= retoma en el paso derivado del tenant (no fijo en 1)", async () => {
    useAuthStore.getState().setAuth(
      "jwt-demo",
      demoUser(
        tenantFixture({
          country: "MX",
          legalName: "Acme SA de CV",
          taxId: "ACM010101AAA",
          address: "Av. Siempre Viva 123",
        }),
      ),
    );

    await renderRoute("/onboarding");

    expect(await screen.findByTestId("step-fields")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
  });

  // N1 (verify-report, pasada 2 — hallazgo del auditor sobre la remediación
  // W1): el test de arriba entra por `/onboarding` DIRECTO, así que solo
  // ejercita la derivación (`effectiveStep`) — nunca pasa por
  // `OnboardingGate`. Y `onboarding-gate.test.tsx` monta un `/onboarding`
  // de juguete (un `<p>`) que no puede ver en qué paso aterriza. Resultado:
  // si alguien reintrodujera `search={{ step: 1 }}` en
  // `onboarding-gate.tsx`, las 27 pruebas de gate+onboarding seguían
  // verdes — nadie ejercitaba el camino REAL (gate redirige -> aterriza en
  // el paso derivado). Este test entra por `/dashboard` con el `routeTree`
  // real: `OnboardingGate` (montado de verdad ahí, no un doble) redirige, y
  // se comprueba que el aterrizaje es en el paso derivado (4, negocio +
  // plantilla completos) con la búsqueda LIMPIA — no en el paso 1.
  it("N1: entrar a /dashboard con el wizard a mitad de camino, el gate REAL redirige y aterriza en el paso derivado (no en 1)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));

    const router = await renderRoute("/dashboard");

    expect(await screen.findByTestId("step-invites")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/onboarding");
    // Búsqueda limpia: el gate NO fuerza `step=1` (ni ningún otro valor) al
    // redirigir — el paso sale de derivar el tenant, no de la URL.
    expect(router.state.location.search).not.toHaveProperty("step", 1);
  });

  // 01.19: recarga a mitad del wizard — pedir ?step=3 con el paso 1
  // incompleto cae a 1, derivado del tenant del server (NO del state
  // pedido en la URL).
  it("recarga en ?step=3 con el paso 1 incompleto: el piso server-derivado lo hace caer a 1", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));

    await renderRoute("/onboarding?step=3");

    expect(await screen.findByLabelText("Nombre legal")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-coming-soon")).not.toBeInTheDocument();
  });

  it("Guardar y avanzar: completar el paso 1 llama PATCH /tenants/me y avanza al paso 2 SOLO en onSuccess", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));
    const updatedTenant = tenantFixture({
      country: "MX",
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
    await screen.findByLabelText("Nombre legal");

    // Ad-hoc post-Fase 1 (2026-08-16, MERCADOS.md §2): país es el PRIMER
    // campo requerido — sin elegirlo, el submit ni siquiera dispara el PATCH.
    await user.selectOptions(screen.getByLabelText("País"), "MX");
    await user.type(screen.getByLabelText("Nombre legal"), "Acme SA de CV");
    await user.type(screen.getByLabelText("Identificación fiscal (RFC)"), "ACM010101AAA");
    await user.type(screen.getByLabelText("Dirección"), "Av. Siempre Viva 123");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() =>
      expect(mockedTenantApi.updateMyTenant).toHaveBeenCalledWith(
        {
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

    expect(await screen.findByTestId("step-fields")).toBeInTheDocument();
    expect(mockedGetMe).toHaveBeenCalledTimes(1);
  });

  // W2 (verify-report #357): el PATCH persistió del lado del server, pero el
  // `.catch(() => {})` de `useUpdateMyTenant` (lib/tenant/hooks.ts) tragaba
  // el fallo de `resyncSession()` — el store seguía con el tenant VIEJO, el
  // wizard rebotaba al paso 1 sin un solo mensaje. Fix: mismo patrón que
  // `useCompleteOnboarding` (no traga el error) — la mutación en sí queda en
  // error y el form ya sabe pintarlo (`updateTenantMutation.isError`).
  it("W2: si el PATCH persiste pero el resync de /me falla, se queda en el paso con un error visible (no rebota mudo)", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantFixture()));
    const updatedTenant = tenantFixture({
      country: "MX",
      legalName: "Acme SA de CV",
      taxId: "ACM010101AAA",
      address: "Av. Siempre Viva 123",
    });
    mockedTenantApi.updateMyTenant.mockResolvedValue(updatedTenant);
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
    // Se quedó en el paso 1 — NO avanzó con el store desactualizado.
    expect(screen.getByLabelText("Nombre legal")).toBeInTheDocument();
  });

  it("sin sesión (accessToken && !user, ventana de bootstrap): muestra loading, no el form", async () => {
    // Token puesto directo (bypass setAuth) para simular la ventana entre
    // setToken() y setAuth() del bootstrap — mismo patrón que S6/#321.
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

  // F1-WEB-ONBOARD-02, criterio del tablero: "decisión guardada en
  // Tenant.template_choice (temporal)".
  function tenantWithBusinessDone(overrides: Partial<AuthUser["tenant"]> = {}) {
    return tenantFixture({
      country: "MX",
      legalName: "Acme SA de CV",
      taxId: "ACM010101AAA",
      address: "Av. Siempre Viva 123",
      ...overrides,
    });
  }

  it("con negocio completo y sin pasar por el paso 2, renderiza el paso 2 (campos del catálogo)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));

    await renderRoute("/onboarding?step=2");

    // F2-ONBOARD-02: sin rubros. El paso muestra los campos ESTÁNDAR y deja
    // agregar los propios — SellPoint no trae campos de ningún giro.
    expect(await screen.findByTestId("step-fields")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del campo")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("F2-ONBOARD-02: el paso 2 marca templateChoice y avanza al 3 SOLO en onSuccess", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));
    const updatedTenant = tenantWithBusinessDone({ templateChoice: "custom" });
    let resolvePatch: (value: tenantApi.TenantBlock) => void = () => {};
    mockedTenantApi.updateMyTenant.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    mockedGetMe.mockResolvedValue(demoUser(updatedTenant));

    await renderRoute("/onboarding?step=2");
    await screen.findByTestId("step-fields");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    await waitFor(() =>
      expect(mockedTenantApi.updateMyTenant).toHaveBeenCalledWith(
        { templateChoice: "custom" },
        expect.anything(),
      ),
    );
    // Todavía no navegó: el PATCH sigue pendiente.
    expect(screen.getByTestId("step-fields")).toBeInTheDocument();

    resolvePatch(updatedTenant);

    expect(await screen.findByTestId("step-warehouse")).toBeInTheDocument();
    expect(mockedGetMe).toHaveBeenCalledTimes(1);
  });

  // W4 (verify-report #357, revierte Deviation 6): con negocio y plantilla
  // completos el piso YA es 4 — el paso 3 es un placeholder sin estado
  // propio que retener, así que pedir `?step=4` directo (sin haber "visto"
  // el paso 3) SÍ lo alcanza. Nada se pierde: el paso 3 no tiene datos.
  it("recarga en ?step=4 con negocio y plantilla completos: entra directo al paso 4 (el piso ya es 4)", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt-demo", demoUser(tenantWithBusinessDone({ templateChoice: "grocery" })));

    await renderRoute("/onboarding?step=4");

    expect(await screen.findByTestId("step-invites")).toBeInTheDocument();
    expect(screen.queryByTestId("step-warehouse")).not.toBeInTheDocument();
  });

  it.skip("con lng: 'en', las plantillas del paso 2 se muestran en inglés", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithBusinessDone()));

    await renderRoute("/onboarding?step=2", "en");

    expect(await screen.findByRole("radio", { name: "Pharmacy" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Hardware store" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Grocery" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Custom" })).toBeInTheDocument();
  });

  // F1-WEB-ONBOARD-03, criterio del tablero: "continuar funciona" — placeholder
  // informativo del primer almacén (el CRUD real es F2, D2). Mismo patrón que
  // el paso 2.
  function tenantWithTemplateDone(overrides: Partial<AuthUser["tenant"]> = {}) {
    return tenantWithBusinessDone({ templateChoice: "pharmacy", ...overrides });
  }

  it("con negocio y plantilla completos, renderiza el paso 3 (placeholder de almacén)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithTemplateDone()));

    await renderRoute("/onboarding?step=3");

    expect(await screen.findByTestId("step-warehouse")).toBeInTheDocument();
  });

  // W4 (verify-report #357, revierte Deviation 6): "Continuar" en el paso 3
  // avanza al paso 4 SIN llamada de escritura adicional — el requirement
  // original del tablero, cumplido de nuevo (spec #348, paso 3: "avanza al
  // paso 4 sin llamada de escritura adicional").
  it("Continuar en el paso 3: avanza al paso 4 SIN llamar PATCH /tenants/me", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithTemplateDone()));

    await renderRoute("/onboarding?step=3");
    await screen.findByTestId("step-warehouse");
    await user.click(screen.getByRole("button", { name: "Continuar" }));

    // F1-WEB-ONBOARD-04: el paso 4 ya NO es el placeholder genérico — es
    // `StepInvites` (invitar usuarios, skippable).
    expect(await screen.findByTestId("step-invites")).toBeInTheDocument();
    expect(mockedTenantApi.updateMyTenant).not.toHaveBeenCalled();
    expect(mockedGetMe).not.toHaveBeenCalled();
  });

  // F1-WEB-ONBOARD-04, criterio del tablero: "invitaciones llegan". D5
  // (#347): email+nombre+rol por fila, reusa `POST /users` (createUser)
  // sin relajar el DTO — el mail real lo manda el backend (probado e2e en
  // f1-invitations); acá solo se prueba que el wizard llama al endpoint
  // correcto por cada fila.
  function tenantReadyForInvites(overrides: Partial<AuthUser["tenant"]> = {}) {
    return tenantWithTemplateDone({ ...overrides });
  }

  it("con negocio y plantilla completos, renderiza el paso 4 (invitar usuarios) con una fila vacía", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));

    await renderRoute("/onboarding?step=4");

    expect(await screen.findByTestId("step-invites")).toBeInTheDocument();
    expect(mockedRbacApi.listRoles).toHaveBeenCalled();
  });

  it("Enviar invitaciones: llama POST /users por cada fila y, si todas tienen éxito, cierra el onboarding y aterriza en /dashboard", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));
    mockedRbacApi.createUser.mockImplementation(async (input) => ({
      id: `new-${input.email}`,
      email: input.email,
      firstName: input.firstName,
      lastNamePaternal: input.lastNamePaternal,
      lastNameMaternal: null,
      status: "invited",
      locale: "es",
      roles: [{ id: input.roleIds[0] ?? "", name: "Cajero" }],
    }));
    const onboardedTenant = tenantReadyForInvites({ onboarded: true });
    mockedTenantApi.completeOnboarding.mockResolvedValue(onboardedTenant);
    mockedGetMe.mockResolvedValue(demoUser(onboardedTenant));

    await renderRoute("/onboarding?step=4");
    await screen.findByTestId("step-invites");

    await user.type(screen.getByLabelText("Email"), "ana@acme.mx");
    await user.type(screen.getByLabelText("Nombre"), "Ana");
    await user.type(screen.getByLabelText("Apellido paterno"), "García");
    await user.selectOptions(screen.getByLabelText("Rol"), "Cajero");
    await user.click(screen.getByRole("button", { name: "Agregar fila" }));
    const rows = screen.getAllByTestId(/^invite-row-\d$/);
    const secondRow = rows[1];
    if (!secondRow) throw new Error("se esperaba una segunda fila");
    await user.type(within(secondRow).getByLabelText("Email"), "beto@acme.mx");
    await user.type(within(secondRow).getByLabelText("Nombre"), "Beto");
    await user.type(within(secondRow).getByLabelText("Apellido paterno"), "López");
    await user.selectOptions(within(secondRow).getByLabelText("Rol"), "Admin");

    await user.click(screen.getByRole("button", { name: "Enviar invitaciones" }));

    await waitFor(() =>
      expect(mockedRbacApi.createUser).toHaveBeenCalledWith(
        { email: "ana@acme.mx", firstName: "Ana", lastNamePaternal: "García", roleIds: ["r1"] },
        expect.anything(),
      ),
    );
    expect(mockedRbacApi.createUser).toHaveBeenCalledWith(
      { email: "beto@acme.mx", firstName: "Beto", lastNamePaternal: "López", roleIds: ["r2"] },
      expect.anything(),
    );
    expect(mockedRbacApi.createUser).toHaveBeenCalledTimes(2);

    // Todas las filas tuvieron éxito: el wizard llama a
    // `POST /tenants/me/complete-onboarding`, resincroniza la sesión y
    // navega a /dashboard (F1-WEB-ONBOARD-05, criterio del tablero:
    // "próximos logins van directo a dashboard, no a wizard").
    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(mockedTenantApi.completeOnboarding).toHaveBeenCalledTimes(1);
    expect(mockedGetMe).toHaveBeenCalledTimes(1);
  });

  it("Invitación múltiple con resultado parcial: la fila con email duplicado muestra su error y NO bloquea a las demás ni avanza", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));
    mockedRbacApi.createUser.mockImplementation(async (input) => {
      if (input.email === "ana@acme.mx") {
        return Promise.reject({
          statusCode: 409,
          message: "Ese correo ya está en uso.",
          error: "Conflict",
          code: "users.email_taken",
        });
      }
      return {
        id: `new-${input.email}`,
        email: input.email,
        firstName: input.firstName,
        lastNamePaternal: input.lastNamePaternal,
        lastNameMaternal: null,
        status: "invited",
        locale: "es",
        roles: [{ id: input.roleIds[0] ?? "", name: "Cajero" }],
      };
    });

    await renderRoute("/onboarding?step=4");
    await screen.findByTestId("step-invites");

    await user.type(screen.getByLabelText("Email"), "ana@acme.mx");
    await user.type(screen.getByLabelText("Nombre"), "Ana");
    await user.type(screen.getByLabelText("Apellido paterno"), "García");
    await user.selectOptions(screen.getByLabelText("Rol"), "Cajero");
    await user.click(screen.getByRole("button", { name: "Agregar fila" }));
    const secondRow = screen.getAllByTestId(/^invite-row-\d$/)[1];
    if (!secondRow) throw new Error("se esperaba una segunda fila");
    await user.type(within(secondRow).getByLabelText("Email"), "beto@acme.mx");
    await user.type(within(secondRow).getByLabelText("Nombre"), "Beto");
    await user.type(within(secondRow).getByLabelText("Apellido paterno"), "López");
    await user.selectOptions(within(secondRow).getByLabelText("Rol"), "Admin");

    await user.click(screen.getByRole("button", { name: "Enviar invitaciones" }));

    expect(await screen.findByText("Ese correo ya está en uso.")).toBeInTheDocument();
    expect(await within(secondRow).findByText("Invitación enviada.")).toBeInTheDocument();
    // No todas tuvieron éxito: el wizard NO avanza, sigue en el paso 4 para
    // que el usuario corrija la fila fallida.
    expect(screen.getByTestId("step-invites")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-coming-soon")).not.toBeInTheDocument();
  });

  // W3 (verify-report #357): `inviteResults` se indexaba por POSICIÓN del
  // array. Repro exacto del verify: fila 0 (ana) falla con 409, fila 1
  // (beto) tiene éxito; el usuario borra la fila fallida (única que puede
  // borrarse — la exitosa está deshabilitada) y la fila restante (beto)
  // hereda el índice 0, "robándose" el resultado de ana (su error) y
  // perdiendo su propia marca de éxito. Al reenviar, `beto` se re-invita y
  // en producción pega un 409 sobre alguien YA invitado. Fix: indexar por
  // `field.id` de `useFieldArray` (estable ante `remove`/`append`).
  it("W3: borrar la fila fallida NO corre el resultado de la fila exitosa a la fila equivocada", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));
    mockedRbacApi.createUser.mockImplementation(async (input) => {
      if (input.email === "ana@acme.mx") {
        return Promise.reject({
          statusCode: 409,
          message: "Ese correo ya está en uso.",
          error: "Conflict",
          code: "users.email_taken",
        });
      }
      return {
        id: `new-${input.email}`,
        email: input.email,
        firstName: input.firstName,
        lastNamePaternal: input.lastNamePaternal,
        lastNameMaternal: null,
        status: "invited",
        locale: "es",
        roles: [{ id: input.roleIds[0] ?? "", name: "Cajero" }],
      };
    });
    const onboardedTenant = tenantReadyForInvites({ onboarded: true });
    mockedTenantApi.completeOnboarding.mockResolvedValue(onboardedTenant);
    mockedGetMe.mockResolvedValue(demoUser(onboardedTenant));

    await renderRoute("/onboarding?step=4");
    await screen.findByTestId("step-invites");

    await user.type(screen.getByLabelText("Email"), "ana@acme.mx");
    await user.type(screen.getByLabelText("Nombre"), "Ana");
    await user.type(screen.getByLabelText("Apellido paterno"), "García");
    await user.selectOptions(screen.getByLabelText("Rol"), "Cajero");
    await user.click(screen.getByRole("button", { name: "Agregar fila" }));
    const secondRow = screen.getAllByTestId(/^invite-row-\d$/)[1];
    if (!secondRow) throw new Error("se esperaba una segunda fila");
    await user.type(within(secondRow).getByLabelText("Email"), "beto@acme.mx");
    await user.type(within(secondRow).getByLabelText("Nombre"), "Beto");
    await user.type(within(secondRow).getByLabelText("Apellido paterno"), "López");
    await user.selectOptions(within(secondRow).getByLabelText("Rol"), "Admin");

    await user.click(screen.getByRole("button", { name: "Enviar invitaciones" }));

    expect(await screen.findByText("Ese correo ya está en uso.")).toBeInTheDocument();
    expect(await within(secondRow).findByText("Invitación enviada.")).toBeInTheDocument();

    // Borro la fila fallida (fila 0, ana) — es la única con el botón
    // "Quitar fila" habilitado (la exitosa está deshabilitada).
    const firstRow = screen.getByTestId("invite-row-0");
    await user.click(within(firstRow).getByRole("button", { name: "Quitar fila" }));

    // Queda 1 sola fila: la de beto. Debe conservar SU resultado (éxito),
    // no el error de ana.
    const remainingRow = screen.getByTestId("invite-row-0");
    expect(within(remainingRow).getByLabelText("Email")).toHaveValue("beto@acme.mx");
    expect(within(remainingRow).queryByText("Ese correo ya está en uso.")).not.toBeInTheDocument();
    expect(within(remainingRow).getByText("Invitación enviada.")).toBeInTheDocument();

    // Reenviar (con solo la fila de beto, ya exitosa) NO debe re-invitar a
    // beto — todas las filas enviadas ya están en éxito, así que cierra el
    // onboarding directo, sin una tercera llamada a createUser.
    await user.click(screen.getByRole("button", { name: "Enviar invitaciones" }));

    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(mockedRbacApi.createUser).toHaveBeenCalledTimes(2);
  });

  it("Omitir en el paso 4: cierra el onboarding sin llamar createUser y aterriza en /dashboard (D6, skippable)", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));
    const onboardedTenant = tenantReadyForInvites({ onboarded: true });
    mockedTenantApi.completeOnboarding.mockResolvedValue(onboardedTenant);
    mockedGetMe.mockResolvedValue(demoUser(onboardedTenant));

    await renderRoute("/onboarding?step=4");
    await screen.findByTestId("step-invites");

    await user.click(screen.getByRole("button", { name: "Omitir" }));

    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(mockedRbacApi.createUser).not.toHaveBeenCalled();
    expect(mockedTenantApi.completeOnboarding).toHaveBeenCalledTimes(1);
  });

  it("Si completar el onboarding falla, se queda en el paso 4 con el error y NO navega", async () => {
    const user = userEvent.setup();
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));
    mockedTenantApi.completeOnboarding.mockRejectedValue({
      statusCode: 500,
      message: "Internal error",
      error: "Internal Server Error",
    });

    await renderRoute("/onboarding?step=4");
    await screen.findByTestId("step-invites");

    await user.click(screen.getByRole("button", { name: "Omitir" }));

    expect(await screen.findByText("No pudimos finalizar la configuración.")).toBeInTheDocument();
    expect(screen.getByTestId("step-invites")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-title")).not.toBeInTheDocument();
    expect(mockedGetMe).not.toHaveBeenCalled();
  });

  // F1-WEB-ONBOARD-05, requirement transversal "Gate de redirect por estado
  // de onboarding": un tenant YA onboarded que navega directo a /onboarding
  // (a mano, o un link viejo) nunca ve el wizard — va a /dashboard.
  it("con tenant.onboarded=true, navegar a /onboarding redirige a /dashboard sin mostrar el wizard", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt-demo", demoUser(tenantReadyForInvites({ onboarded: true })));

    await renderRoute("/onboarding");

    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre legal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("step-invites")).not.toBeInTheDocument();
  });

  it("con lng: 'en', el paso 4 se muestra en inglés", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantReadyForInvites()));

    await renderRoute("/onboarding?step=4", "en");

    expect(await screen.findByText("Invite your team")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send invitations" })).toBeInTheDocument();
  });

  it("con lng: 'en', el paso 3 se muestra en inglés", async () => {
    useAuthStore.getState().setAuth("jwt-demo", demoUser(tenantWithTemplateDone()));

    await renderRoute("/onboarding?step=3", "en");

    expect(await screen.findByText("Your first warehouse")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });
});
