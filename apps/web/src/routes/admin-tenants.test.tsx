import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as adminApi from "@/lib/admin/api";
import * as billingApi from "@/lib/billing/api";
import * as dashboardApi from "@/lib/dashboard/api";
import { createQueryClient } from "@/lib/query-client";
import * as reportsApi from "@/lib/reports/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-ADMIN-06..11 — «Negocios» y el expediente de un negocio: la lista, las
 * pestañas por URL, suspender desde el backoffice, activar un módulo, y el
 * dashboard y los reportes apuntados al negocio mirado.
 */
vi.mock("@/lib/billing/api", async (importOriginal) => ({
  ...(await importOriginal<typeof billingApi>()),
  getAdminTenants: vi.fn(),
  getAdminTenantDetail: vi.fn(),
  getPlans: vi.fn().mockResolvedValue([]),
  enableModule: vi.fn(),
  disableModule: vi.fn(),
}));
vi.mock("@/lib/admin/api", () => ({
  getTenantOverview: vi.fn(),
  listTenantUsers: vi.fn(),
  suspendTenantUser: vi.fn(),
  reactivateTenantUser: vi.fn(),
}));
vi.mock("@/lib/dashboard/api", async (importOriginal) => ({
  ...(await importOriginal<typeof dashboardApi>()),
  getDashboardKpis: vi.fn(),
  getDashboardSeries: vi.fn().mockResolvedValue({ byDay: [], byHour: [] }),
  getDashboardProducts: vi.fn().mockResolvedValue({ topSold: [], topProfit: [] }),
  getDashboardInventory: vi.fn().mockResolvedValue({ outOfStock: 0, belowMin: 0, attention: [] }),
  getDashboardPayments: vi.fn().mockResolvedValue({ methods: [] }),
}));
vi.mock("@/lib/reports/api", async (importOriginal) => ({
  ...(await importOriginal<typeof reportsApi>()),
  getSalesReport: vi.fn(),
  getStockReport: vi.fn(),
}));
vi.mock("@/lib/warehouses/api", () => ({
  listWarehouses: vi.fn().mockResolvedValue([]),
}));

const mockedTenants = vi.mocked(billingApi.getAdminTenants);
const mockedOverview = vi.mocked(adminApi.getTenantOverview);
const mockedUsers = vi.mocked(adminApi.listTenantUsers);
const mockedSuspend = vi.mocked(adminApi.suspendTenantUser);
const mockedEnable = vi.mocked(billingApi.enableModule);
const mockedKpis = vi.mocked(dashboardApi.getDashboardKpis);
const mockedSales = vi.mocked(reportsApi.getSalesReport);

const demoUser = (isPlatformAdmin: boolean): AuthUser => ({
  id: "u1",
  email: "carls.hlm@gmail.com",
  firstName: "Carlos",
  lastNamePaternal: "H",
  lastNameMaternal: null,
  locale: "es",
  permissions: ["tenants:manage"],
  isPlatformAdmin,
  subscription: SUBSCRIPTION_PLUS,
  tenant: {
    id: "tenant-1",
    name: "SellPointy HQ",
    legalName: null,
    taxId: null,
    address: null,
    phone: null,
    theme: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations: false,
    monthlySalesGoal: null,
  },
});

async function renderEn(path: string, isPlatformAdmin = true) {
  useAuthStore.getState().setAuth("jwt", demoUser(isPlatformAdmin));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

const overview: adminApi.TenantOverview = {
  tenant: {
    name: "Acme",
    country: "MX",
    currency: "MXN",
    timezone: "America/Mexico_City",
    onboarded: true,
  },
  users: { active: 3, invited: 1, suspended: 0 },
  counts: { products: 120, services: 7, subcatalogs: 4, warehouses: 2 },
  subscription: {
    planCode: "plus",
    planName: "Plus",
    status: "active",
    billingCycle: "monthly",
    dueAt: "2026-10-02T06:00:00.000Z",
    customPrice: null,
  },
  modules: [],
};

beforeEach(() => {
  mockedTenants.mockResolvedValue({
    tenants: [
      {
        tenantId: "t1",
        tenantName: "Acme",
        country: "MX",
        currency: "MXN",
        planCode: "plus",
        planName: "Plus",
        status: "active",
        billingCycle: "monthly",
        dueAt: "2026-10-02T06:00:00.000Z",
        lastPaymentAt: null,
        timezone: "America/Mexico_City",
        modules: ["reception"],
        charges: [],
      },
    ],
    mrrByCurrency: {},
  });
  mockedOverview.mockResolvedValue(overview);
  mockedUsers.mockResolvedValue([
    {
      id: "u2",
      email: "ana@acme.mx",
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
      defaultWarehouseId: null,
      roles: [{ id: "r1", name: "Manager" }],
    },
  ]);
  mockedSuspend.mockResolvedValue({
    id: "u2",
    email: "ana@acme.mx",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    lastNameMaternal: null,
    status: "suspended",
    locale: "es",
    defaultWarehouseId: null,
    roles: [],
  });
  mockedEnable.mockResolvedValue(["reception"]);
  mockedKpis.mockResolvedValue({
    today: { total: "30.00", tickets: 1, averageTicket: "30.00", deltaVsLastWeekPct: null },
    month: { total: "30.00", deltaVsPrevMonthPct: null, goal: null, goalPct: null },
    profit: { month: null, deltaVsPrevMonthPct: null },
  });
  mockedSales.mockResolvedValue({ rows: [], totals: [], total: 0, page: 1, pageSize: 20 });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("«Negocios» (F9-ADMIN-06)", () => {
  it("el menú Backoffice tiene «Negocios» y la lista abre el expediente con sus módulos", async () => {
    await renderEn("/admin/tenants");
    const grupo = await screen.findByRole("group", { name: "Backoffice" });
    expect(within(grupo).getByRole("link", { name: "Negocios" })).toHaveAttribute(
      "href",
      "/admin/tenants",
    );
    const fila = await screen.findByTestId("tenant-row-t1");
    expect(within(fila).getByRole("link", { name: "Acme" }).getAttribute("href")).toContain(
      "/admin/tenants/t1",
    );
    expect(within(fila).getByText("Recepción")).toBeInTheDocument();
  });

  it("sin el flag, ni el link ni la página", async () => {
    const router = await renderEn("/admin/tenants", false);
    await waitFor(() => expect(router.state.location.pathname).toBe("/dashboard"));
    expect(screen.queryByRole("link", { name: "Negocios" })).not.toBeInTheDocument();
  });
});

describe("el expediente (F9-ADMIN-07..11)", () => {
  it("Resumen pinta los conteos y cambiar de pestaña cambia la URL", async () => {
    const router = await renderEn("/admin/tenants/t1?tab=overview");
    const resumen = await screen.findByTestId("tenant-overview");
    expect(within(resumen).getByText("120")).toBeInTheDocument();
    expect(within(resumen).getByText("4")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Usuarios" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ tab: "users" }));
  });

  it("Usuarios: Suspender llama al endpoint del negocio de la URL y un 409 se ve", async () => {
    await renderEn("/admin/tenants/t1?tab=users");
    const user = userEvent.setup();
    const fila = await screen.findByTestId("tenant-user-u2");
    mockedSuspend.mockRejectedValueOnce(
      Object.assign(new Error("Es el último administrador activo."), { status: 409 }),
    );
    await user.click(within(fila).getByRole("button", { name: "Suspender" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/último administrador/);
    expect(mockedSuspend).toHaveBeenCalledWith("t1", "u2");
    expect(within(screen.getByTestId("tenant-user-u2")).getByText("Activo")).toBeInTheDocument();
  });

  it("Plan y módulos: activar exige motivo y manda el precio pactado; el 422 se ve", async () => {
    await renderEn("/admin/tenants/t1?tab=plan");
    const user = userEvent.setup();
    const fila = await screen.findByTestId("module-reception");
    const activar = within(fila).getByRole("button", { name: "Activar" });
    expect(activar).toBeDisabled();

    await user.type(screen.getByLabelText(/Motivo/), "deal VIP");
    await user.type(screen.getByLabelText(/Precio pactado/), "1250.00");
    mockedEnable.mockRejectedValueOnce(
      Object.assign(new Error("Un plan sin precio publicado necesita un precio pactado."), {
        status: 422,
      }),
    );
    await user.click(activar);
    expect(mockedEnable).toHaveBeenCalledWith("t1", {
      moduleKey: "reception",
      reason: "deal VIP",
      customPrice: "1250.00",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(/precio pactado/);
  });

  it("Panel: pide el dashboard del negocio mirado, no el propio", async () => {
    await renderEn("/admin/tenants/t1?tab=dashboard");
    await screen.findByTestId("tenant-dashboard");
    await waitFor(() => expect(mockedKpis).toHaveBeenCalledWith("/admin/tenants/t1"));
  });

  it("Reportes: pide las ventas del negocio mirado con el prefijo del expediente", async () => {
    await renderEn("/admin/tenants/t1?tab=reports");
    await screen.findByTestId("tenant-reports");
    await waitFor(() =>
      expect(mockedSales).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 }),
        "/admin/tenants/t1",
      ),
    );
  });
});

describe("el dashboard del cliente no cambia (no-regresión)", () => {
  it("/dashboard sigue pidiendo /reports sin prefijo", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt", { ...demoUser(false), permissions: ["reports:read", "inventory:read"] });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await waitFor(() => expect(mockedKpis).toHaveBeenCalled());
    expect(mockedKpis).toHaveBeenCalledWith();
  });
});
