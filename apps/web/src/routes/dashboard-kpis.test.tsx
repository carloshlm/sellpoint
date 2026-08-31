import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import type { DashboardKpis } from "../lib/dashboard/api";
import * as dashboardApi from "../lib/dashboard/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F5-DASH-10 — la fila de KPIs de la pantalla inicial.
 *
 * Las reglas que estas aserciones protegen: los números de DINERO solo
 * existen con `reports:read` (sin él ni siquiera se PIDEN — un cajero no
 * debe ver los números del dueño ni en la pestaña Red), y la utilidad null
 * dice «Aún sin datos de costo» — porque «no sé» y «$0» son historias
 * distintas.
 */
vi.mock("../lib/dashboard/api", () => ({
  getDashboardKpis: vi.fn(),
  getDashboardSeries: vi.fn().mockResolvedValue({ byDay: [], byHour: [] }),
  getDashboardProducts: vi.fn().mockResolvedValue({ topSold: [], topProfit: [] }),
  getDashboardInventory: vi.fn().mockResolvedValue({ outOfStock: 0, belowMin: 0, attention: [] }),
  getDashboardPayments: vi.fn().mockResolvedValue({ methods: [] }),
}));
vi.mock("../lib/inventory/api", () => ({
  listExpiring: vi.fn().mockResolvedValue([]),
}));

const mocked = vi.mocked(dashboardApi.getDashboardKpis);

const KPIS: DashboardKpis = {
  today: { total: "48520", tickets: 126, averageTicket: "385.08", deltaVsLastWeekPct: 12.4 },
  month: { total: "685240", deltaVsPrevMonthPct: 8.7, goal: "800000", goalPct: 85.7 },
  profit: { month: "214580", deltaVsPrevMonthPct: 11.2 },
};

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: SUBSCRIPTION_PLUS,
  tenant: {
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
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations: false,
    monthlySalesGoal: "800000",
  },
});

async function renderDashboard(permissions: string[] = ["reports:read"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
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
}

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue(KPIS);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("La fila de KPIs (F5-DASH-10)", () => {
  it("con reports:read pinta las cuatro tarjetas con sus valores", async () => {
    await renderDashboard();

    expect(await screen.findByText("Ventas de hoy")).toBeInTheDocument();
    expect(screen.getByText("$48,520.00")).toBeInTheDocument();
    expect(screen.getByText("Ventas del mes")).toBeInTheDocument();
    expect(screen.getByText("$685,240.00")).toBeInTheDocument();
    expect(screen.getByText("85.7% de la meta")).toBeInTheDocument();
    expect(screen.getByText("Utilidad del mes")).toBeInTheDocument();
    expect(screen.getByText("$214,580.00")).toBeInTheDocument();
    // La utilidad compara contra el mes anterior corrido, como las ventas.
    expect(screen.getByText(/11.2%/)).toHaveClass("text-success");
    expect(screen.getByText("Tickets de hoy")).toBeInTheDocument();
    expect(screen.getByText("126")).toBeInTheDocument();
    expect(screen.getByText("$385.08 promedio")).toBeInTheDocument();
  });

  it("sin reports:read no hay UN número de dinero — y ni siquiera se piden", async () => {
    await renderDashboard(["inventory:read"]);

    expect(await screen.findByTestId("dashboard-title")).toBeInTheDocument();
    expect(screen.queryByText("Ventas de hoy")).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    // La contraprueba fuerte: el dato NO viaja. Ocultarlo con CSS dejaría
    // los números del negocio en la pestaña Red del cajero.
    expect(mocked).not.toHaveBeenCalled();
  });

  it("la utilidad sin snapshot dice «Aún sin datos de costo», no $0", async () => {
    mocked.mockResolvedValue({ ...KPIS, profit: { month: null, deltaVsPrevMonthPct: null } });

    await renderDashboard();

    await screen.findByText("Utilidad del mes");
    expect(screen.getByText("Aún sin datos de costo")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("un negocio nuevo en ceros no pinta deltas fantasma ni NaN", async () => {
    mocked.mockResolvedValue({
      today: { total: "0", tickets: 0, averageTicket: null, deltaVsLastWeekPct: null },
      month: { total: "0", deltaVsPrevMonthPct: null, goal: null, goalPct: null },
      profit: { month: null, deltaVsPrevMonthPct: null },
    });

    await renderDashboard();

    await screen.findByText("Ventas de hoy");
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
