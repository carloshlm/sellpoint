import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
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
  getDashboardControl: vi.fn().mockResolvedValue({
    cash: {
      shortage: { amount: "0.00", shifts: 0 },
      overage: { amount: "0.00", shifts: 0 },
      closedShifts: 0,
    },
    discounts: { amount: "0.00", tickets: 0, pctOfSales: null },
    cancellations: { count: 0, amount: "0.00" },
    range: { from: "2026-03-01", to: "2026-03-15" },
  }),
}));
vi.mock("../lib/inventory/api", () => ({
  listExpiring: vi.fn().mockResolvedValue([]),
}));

const mocked = vi.mocked(dashboardApi.getDashboardKpis);

const KPIS: DashboardKpis = {
  today: { total: "48520", tickets: 126, averageTicket: "385.08", deltaVsLastWeekPct: 12.4 },
  month: { total: "685240", deltaVsPrevMonthPct: 8.7, goal: "800000", goalPct: 85.7 },
  profit: {
    month: "214580",
    deltaVsPrevMonthPct: 11.2,
    netMonth: "180000",
    netDeltaVsPrevMonthPct: 5.1,
  },
};

const demoUser = (permissions: string[], modules: string[] = []): AuthUser =>
  buildAuthUser({
    permissions,
    tenant: buildTenantBlock({ monthlySalesGoal: "800000" }),
    subscription: { ...SUBSCRIPTION_PLUS, modules: modules as never },
  });

async function renderDashboard(permissions: string[] = ["reports:read"], modules: string[] = []) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions, modules));
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

  /** F9-EXP-11 — la utilidad NETA existe solo con el módulo de Gastos. */
  it("con Gastos aparece la utilidad neta; sin el módulo, no", async () => {
    await renderDashboard(["reports:read"], ["expenses"]);
    expect(await screen.findByText("Utilidad neta del mes")).toBeInTheDocument();
    expect(screen.getByText("$180,000.00")).toBeInTheDocument();
  });

  it("sin el módulo de Gastos no hay tarjeta de utilidad neta", async () => {
    await renderDashboard(["reports:read"]);
    expect(await screen.findByText("Utilidad del mes")).toBeInTheDocument();
    expect(screen.queryByText("Utilidad neta del mes")).not.toBeInTheDocument();
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
    mocked.mockResolvedValue({
      ...KPIS,
      profit: {
        month: null,
        deltaVsPrevMonthPct: null,
        netMonth: null,
        netDeltaVsPrevMonthPct: null,
      },
    });

    await renderDashboard();

    await screen.findByText("Utilidad del mes");
    expect(screen.getByText("Aún sin datos de costo")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  /**
   * F10-KPI-07 — los dos renglones que convierten un número en una decisión:
   * «¿me deja lo suficiente?» (el margen) y «¿voy a llegar?» (el cierre
   * estimado y lo que falta al día). Sin dato, el renglón calla.
   */
  describe("margen y cierre estimado (F10-KPI-07)", () => {
    it("«Utilidad del mes» dice su margen", async () => {
      mocked.mockResolvedValue({ ...KPIS, profit: { ...KPIS.profit, marginPct: 17.2 } });

      await renderDashboard();

      expect(await screen.findByText("17.2% de margen")).toBeInTheDocument();
    });

    it("«Ventas del mes» dice el cierre estimado y lo que falta al día para la meta", async () => {
      mocked.mockResolvedValue({
        ...KPIS,
        month: { ...KPIS.month, projected: "790000", requiredDaily: "7086.47" },
      });

      await renderDashboard();

      expect(await screen.findByText("Cierre estimado: $790,000.00")).toBeInTheDocument();
      expect(screen.getByText("Para tu meta: $7,086.47 al día")).toBeInTheDocument();
      expect(screen.queryByText("Meta alcanzada")).not.toBeInTheDocument();
    });

    it("con la meta alcanzada dice «Meta alcanzada» en lugar de lo que falta", async () => {
      mocked.mockResolvedValue({
        ...KPIS,
        month: {
          ...KPIS.month,
          total: "812000",
          goalPct: 101.5,
          projected: "900000",
          requiredDaily: "0.00",
        },
      });

      await renderDashboard();

      expect(await screen.findByText("Meta alcanzada")).toBeInTheDocument();
      expect(screen.getByText("Cierre estimado: $900,000.00")).toBeInTheDocument();
      expect(screen.queryByText(/Para tu meta/)).not.toBeInTheDocument();
    });

    it("sin dato (null o un API anterior) los renglones no aparecen", async () => {
      // KPIS es la forma de un API anterior: sin margen ni cierre estimado.
      await renderDashboard();
      await screen.findByText("Ventas del mes");
      expect(screen.queryByText(/de margen/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Cierre estimado/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Para tu meta/)).not.toBeInTheDocument();
      expect(screen.queryByText("Meta alcanzada")).not.toBeInTheDocument();
    });

    it("con los campos en null tampoco aparecen", async () => {
      mocked.mockResolvedValue({
        ...KPIS,
        month: { ...KPIS.month, projected: null, requiredDaily: null },
        profit: { ...KPIS.profit, marginPct: null },
      });

      await renderDashboard();

      await screen.findByText("Ventas del mes");
      expect(screen.queryByText(/de margen/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Cierre estimado/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Para tu meta/)).not.toBeInTheDocument();
      expect(screen.queryByText("Meta alcanzada")).not.toBeInTheDocument();
    });
  });

  /**
   * F10-KPI-08 — «Utilidad neta del mes» explica su número: cuánto de los
   * gastos ya cubrió la utilidad, y cuánto falta vender o desde qué día están
   * cubiertos. Solo con el módulo de Gastos, como el mosaico.
   */
  describe("gastos cubiertos (F10-KPI-08)", () => {
    const sinCubrir: DashboardKpis = {
      ...KPIS,
      profit: {
        month: "6782.19",
        deltaVsPrevMonthPct: null,
        netMonth: "-2957.81",
        netDeltaVsPrevMonthPct: null,
        breakEven: {
          expenses: "9740.00",
          coveredPct: 69.6,
          coveredOnDay: null,
          remainingSales: "4361.14",
        },
      },
    };

    it("con Gastos, la neta muestra su número negativo, la barra y lo que falta vender", async () => {
      mocked.mockResolvedValue(sinCubrir);

      await renderDashboard(["reports:read"], ["expenses"]);

      expect(await screen.findByText("69.6% de tus gastos cubiertos")).toBeInTheDocument();
      expect(screen.getByText("Te falta vender $4,361.14")).toBeInTheDocument();
      // El número sigue ahí aunque sea negativo: la barra lo explica, no lo esconde.
      expect(screen.getByText("-$2,957.81")).toBeInTheDocument();
    });

    it("ya cubiertos, el renglón dice desde qué día", async () => {
      mocked.mockResolvedValue({
        ...sinCubrir,
        profit: {
          ...sinCubrir.profit,
          netMonth: "1200",
          breakEven: {
            expenses: "9740.00",
            coveredPct: 112.3,
            coveredOnDay: 19,
            remainingSales: null,
          },
        },
      });

      await renderDashboard(["reports:read"], ["expenses"]);

      expect(await screen.findByText("Gastos cubiertos desde el día 19")).toBeInTheDocument();
      expect(screen.getByText("112.3% de tus gastos cubiertos")).toBeInTheDocument();
      expect(screen.queryByText(/Te falta vender/)).not.toBeInTheDocument();
    });

    it("sin gastos registrados el mosaico queda como hoy", async () => {
      mocked.mockResolvedValue({
        ...KPIS,
        profit: {
          ...KPIS.profit,
          breakEven: {
            expenses: "0.00",
            coveredPct: null,
            coveredOnDay: null,
            remainingSales: null,
          },
        },
      });

      await renderDashboard(["reports:read"], ["expenses"]);

      expect(await screen.findByText("Utilidad neta del mes")).toBeInTheDocument();
      expect(screen.queryByText(/gastos cubiertos/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Te falta vender/)).not.toBeInTheDocument();
    });

    it("sin el módulo de Gastos no aparece", async () => {
      mocked.mockResolvedValue(sinCubrir);

      await renderDashboard(["reports:read"]);

      await screen.findByText("Utilidad del mes");
      expect(screen.queryByText(/gastos cubiertos/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Te falta vender/)).not.toBeInTheDocument();
    });
  });

  it("un negocio nuevo en ceros no pinta deltas fantasma ni NaN", async () => {
    mocked.mockResolvedValue({
      today: { total: "0", tickets: 0, averageTicket: null, deltaVsLastWeekPct: null },
      month: { total: "0", deltaVsPrevMonthPct: null, goal: null, goalPct: null },
      profit: {
        month: null,
        deltaVsPrevMonthPct: null,
        netMonth: null,
        netDeltaVsPrevMonthPct: null,
      },
    });

    await renderDashboard();

    await screen.findByText("Ventas de hoy");
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
