import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import * as dashboardApi from "../lib/dashboard/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F5-DASH-11..15 — los widgets del panel y sus reglas de lectura: el filtro
 * de período gobierna a los suyos, las alertas se COMPONEN de lo ya cargado
 * (cero requests extra — se asevera contando llamadas), y cada vacío es
 * honesto.
 */
vi.mock("../lib/dashboard/api", () => ({
  getDashboardKpis: vi.fn(),
  getDashboardSeries: vi.fn(),
  getDashboardProducts: vi.fn(),
  getDashboardInventory: vi.fn(),
  getDashboardPayments: vi.fn(),
}));
vi.mock("../lib/inventory/api", () => ({
  listExpiring: vi.fn().mockResolvedValue([]),
}));

const mocked = vi.mocked(dashboardApi);

const KPIS: dashboardApi.DashboardKpis = {
  today: { total: "1000", tickets: 4, averageTicket: "250", deltaVsLastWeekPct: -14 },
  month: { total: "50000", deltaVsPrevMonthPct: 5, goal: null, goalPct: null },
  profit: { month: "12000", deltaVsPrevMonthPct: null },
};

const SERIES: dashboardApi.DashboardSeries = {
  byDay: [
    { day: 1, current: "100", previous: "80" },
    { day: 2, current: "150", previous: "90" },
  ],
  byHour: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: hour === 11 ? "200" : "0",
  })),
};

const PRODUCTS: dashboardApi.DashboardProducts = {
  topSold: [
    {
      itemId: "p1",
      sku: "COC-600",
      name: "Coca-Cola 600ml",
      units: "842",
      revenue: "8420",
      deltaPct: 32,
    },
    {
      itemId: "p2",
      sku: "SAB-45",
      name: "Sabritas 45g",
      units: "3",
      revenue: "60",
      deltaPct: null,
    },
  ],
  topProfit: [
    {
      itemId: "p2",
      sku: "SAB-45",
      name: "Sabritas 45g",
      revenue: "60",
      cost: "12",
      profit: "48",
      marginPct: 80,
    },
  ],
};

const INVENTORY: dashboardApi.DashboardInventory = {
  outOfStock: 8,
  belowMin: 27,
  inventoryValue: "1248500",
  attention: [
    {
      productId: "p1",
      sku: "COC-600",
      name: "Coca-Cola 600ml",
      stock: "3",
      stockMin: "20",
      daysLeft: 0.7,
    },
    { productId: "p3", sku: "AGU-1L", name: "Agua 1L", stock: "8", stockMin: "20", daysLeft: null },
  ],
};

const PAYMENTS: dashboardApi.DashboardPayments = {
  methods: [
    { method: "cash", total: "31000", pct: 62 },
    { method: "card", total: "19000", pct: 38 },
  ],
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
    posShowsStock: true,
    monthlySalesGoal: null,
  },
});

async function renderDashboard(permissions: string[] = ["reports:read", "inventory:read"]) {
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
  for (const fn of Object.values(mocked)) {
    fn.mockReset();
  }
  mocked.getDashboardKpis.mockResolvedValue(KPIS);
  mocked.getDashboardSeries.mockResolvedValue(SERIES);
  mocked.getDashboardProducts.mockResolvedValue(PRODUCTS);
  mocked.getDashboardInventory.mockResolvedValue(INVENTORY);
  mocked.getDashboardPayments.mockResolvedValue(PAYMENTS);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Los widgets del panel (F5-DASH-11..15)", () => {
  it("las dos gráficas montan con nombre; un día sin ventas muestra su vacío por hora", async () => {
    await renderDashboard();

    expect(
      await screen.findByRole("img", { name: "Ventas: mes actual vs anterior" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ventas de hoy por hora" })).toBeInTheDocument();

    // Con todo en cero, la de horas no pinta 24 barras mudas.
    mocked.getDashboardSeries.mockResolvedValue({
      ...SERIES,
      byHour: SERIES.byHour.map((h) => ({ ...h, total: "0" })),
    });
    await renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Sin datos del período")).toBeInTheDocument();
    });
  });

  it("el filtro de período re-pide tops y pagos con el período elegido", async () => {
    const user = userEvent.setup();
    await renderDashboard();
    await screen.findByText("Más vendidos");

    await user.click(screen.getByRole("button", { name: "Hoy" }));

    await waitFor(() => {
      expect(mocked.getDashboardProducts).toHaveBeenCalledWith("today");
      expect(mocked.getDashboardPayments).toHaveBeenCalledWith("today");
    });
  });

  it("con ventas pero sin costos, la lista de utilidad NO miente «sin ventas»", async () => {
    // El caso real de Carlos (2026-09-01): ventas previas al snapshot de
    // costo. Hay ventas — lo que no hay es costos congelados, y el vacío
    // tiene que decir ESO.
    mocked.getDashboardProducts.mockResolvedValue({ ...PRODUCTS, topProfit: [] });

    await renderDashboard();

    await screen.findByText("Mayor utilidad");
    expect(screen.getByText(/Aún sin costos congelados/)).toBeInTheDocument();
    expect(screen.queryByText("Sin ventas en el período")).not.toBeInTheDocument();
  });

  it("los tops cuentan las dos historias y la lista de atención predice días", async () => {
    await renderDashboard();

    await screen.findByText("Más vendidos");
    expect(screen.getAllByText("Coca-Cola 600ml").length).toBeGreaterThan(0);
    expect(screen.getByText("Mayor utilidad")).toBeInTheDocument();
    expect(screen.getByText(/80% margen/)).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("27")).toBeInTheDocument();
    expect(screen.getByText("0.7 días restantes")).toBeInTheDocument();
    expect(screen.getByText("Sin ritmo de venta")).toBeInTheDocument();
    // El donut con su leyenda.
    expect(screen.getByText("62%")).toBeInTheDocument();
    // Las tres listas (dos tops + atención) viven en cajas deslizables: en un
    // celular las filas no caben y sin scroll se cortaban en el borde.
    expect(screen.getAllByTestId("scrollable-list")).toHaveLength(3);
  });

  it("las alertas se componen de lo cargado — y cada endpoint se pidió UNA sola vez", async () => {
    await renderDashboard();

    // Las cuatro reglas disparan con este escenario.
    expect(await screen.findByText(/8 productos agotados/)).toBeInTheDocument();
    expect(screen.getByText(/14% abajo del mismo día/)).toBeInTheDocument();
    expect(screen.getByText(/Coca-Cola 600ml creció 32%/)).toBeInTheDocument();
    expect(screen.getByText(/62% de tus ventas del mes es con efectivo/)).toBeInTheDocument();

    // La prueba del «cero requests extra»: alertas + widgets comparten caché.
    expect(mocked.getDashboardKpis).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardProducts).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardInventory).toHaveBeenCalledTimes(1);
    expect(mocked.getDashboardPayments).toHaveBeenCalledTimes(1);
  });

  it("sin condiciones, el bloque de alertas desaparece completo", async () => {
    mocked.getDashboardKpis.mockResolvedValue({
      ...KPIS,
      today: { ...KPIS.today, deltaVsLastWeekPct: 2 },
    });
    mocked.getDashboardProducts.mockResolvedValue({ topSold: [], topProfit: [] });
    mocked.getDashboardInventory.mockResolvedValue({ outOfStock: 0, belowMin: 0, attention: [] });
    mocked.getDashboardPayments.mockResolvedValue({
      methods: [
        { method: "cash", total: "500", pct: 50 },
        { method: "card", total: "500", pct: 50 },
      ],
    });

    await renderDashboard();

    await screen.findByText("Ventas de hoy");
    expect(screen.queryByText(/agotad/)).not.toBeInTheDocument();
    expect(screen.queryByText(/creció/)).not.toBeInTheDocument();
  });

  it("el contador de agotados navega al stock YA filtrado", async () => {
    await renderDashboard();

    const enlace = (await screen.findByText(/Agotados/)).closest("a");
    expect(enlace?.getAttribute("href")).toContain("/reports/stock");
    expect(enlace?.getAttribute("href")).toContain("belowMin=true");
  });
});
