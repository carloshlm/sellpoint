import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as posApi from "@/lib/pos/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * El Panel de quien VENDE (Carlos, 2026-09-12: «¿qué podría ver un vendedor?
 * para que no salga así en blanco, y que no le aparezcan esas pestañas
 * porque no tiene permiso para ver reportes»).
 *
 * Dos reglas: (1) lo que se muestra es SU turno —lo abre él, cobra él, lo
 * cierra él— y nunca un número del negocio; (2) el filtro de período no se
 * pinta si no gobierna nada, porque un control que no controla es peor que
 * ninguno.
 */
vi.mock("@/lib/dashboard/api", () => ({
  // Con `reports:read` la fila de KPIs SÍ pinta: sin una forma válida
  // revienta y se lleva el resto del panel por delante.
  getDashboardKpis: vi.fn().mockResolvedValue({
    today: { total: "0", tickets: 0, averageTicket: "0", deltaVsLastWeekPct: null },
    month: { total: "0", deltaVsPrevMonthPct: null, goal: null, goalPct: null },
    profit: {
      month: "0",
      deltaVsPrevMonthPct: null,
      netMonth: null,
      netDeltaVsPrevMonthPct: null,
    },
  }),
  getDashboardSeries: vi.fn().mockResolvedValue({ byDay: [], byHour: [] }),
  getDashboardProducts: vi.fn().mockResolvedValue({ topSold: [], topProfit: [] }),
  getDashboardInventory: vi.fn().mockResolvedValue({ outOfStock: 0, belowMin: 0, attention: [] }),
  getDashboardPayments: vi.fn().mockResolvedValue({ methods: [] }),
}));
vi.mock("@/lib/inventory/api", () => ({ listExpiring: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/pos/api", () => ({
  getSession: vi.fn(),
  getSessionTotals: vi.fn(),
}));

const mocked = vi.mocked(posApi);

/** Los cinco permisos reales del rol Seller (`POS_SELLER_CODES` del API). */
const SELLER = ["pos:sell", "pos:quote", "pos:view", "products:read", "services:read"];

const TURNO: posApi.CashboxSession = {
  id: "s1",
  warehouseId: "w1",
  status: "open",
  openedAt: "2026-09-12T15:30:00.000Z",
  closedAt: null,
  declaredCash: null,
  calculatedCash: null,
  cashDifference: null,
  closingNote: null,
  warehouse: { id: "w1", name: "Almacén Central" },
};

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({ permissions, subscription: { ...SUBSCRIPTION_PLUS, modules: [] } });

async function renderDashboard(permissions: string[]) {
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
  mocked.getSession.mockResolvedValue({ session: TURNO });
  mocked.getSessionTotals.mockResolvedValue({
    totals: [
      { method: "cash", total: "1200.50", count: 4 },
      { method: "card", total: "800.00", count: 2 },
    ],
    cashExpenses: { total: "0", count: 0 },
    expectedCash: "1200.50",
  });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("el Panel de quien vende (2026-09-12)", () => {
  it("con el turno abierto dice desde cuándo, cuánto lleva cobrado y cuántas ventas", async () => {
    await renderDashboard(SELLER);

    const panel = await screen.findByTestId("seller-panel");
    expect(within(panel).getByTestId("seller-shift")).toHaveTextContent("Turno abierto desde");
    expect(within(panel).getByTestId("seller-shift")).toHaveTextContent("Almacén Central");
    // La suma de los métodos: 1200.50 + 800.00, y 4 + 2 ventas. El arqueo
    // llega DESPUÉS del turno (son dos consultas), así que se espera.
    await waitFor(() =>
      expect(within(panel).getByTestId("seller-charged")).toHaveTextContent("$2,000.50"),
    );
    expect(within(panel).getByTestId("seller-tickets")).toHaveTextContent("6");
    // Los accesos de su trabajo, por permiso.
    expect(within(panel).getByRole("link", { name: "Venta" })).toHaveAttribute("href", "/pos");
    expect(within(panel).getByRole("link", { name: "Cotización" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Historial" })).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Cierre de turno" })).toBeInTheDocument();
  });

  it("sin turno abierto invita a abrirlo y no pide los totales", async () => {
    mocked.getSession.mockResolvedValue({ session: null });
    await renderDashboard(SELLER);

    const panel = await screen.findByTestId("seller-panel");
    expect(within(panel).getByTestId("seller-shift")).toHaveTextContent("No tienes un turno");
    expect(within(panel).getByRole("link", { name: "Abrir turno" })).toHaveAttribute(
      "href",
      "/pos",
    );
    expect(mocked.getSessionTotals).not.toHaveBeenCalled();
  });

  /**
   * La razón de existir de la tarea: cuatro pestañas sobre una pantalla en
   * blanco. El filtro gobierna tops y métodos de pago —los dos de
   * `reports:read`— y el top del consultorio; sin ninguno, no se pinta.
   */
  it("sin reports:read no salen las pestañas de período", async () => {
    await renderDashboard(SELLER);
    await screen.findByTestId("seller-panel");
    expect(screen.queryByRole("button", { name: "Este mes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hoy" })).not.toBeInTheDocument();
  });

  it("con reports:read vuelven las pestañas y el panel del vendedor NO se pinta", async () => {
    await renderDashboard([...SELLER, "reports:read"]);
    await screen.findByTestId("dashboard-title");
    expect(screen.getByRole("button", { name: "Este mes" })).toBeInTheDocument();
    // Quien ve reportes ya tiene sus KPIs arriba: repetir su turno sería ruido.
    expect(screen.queryByTestId("seller-panel")).not.toBeInTheDocument();
    expect(mocked.getSessionTotals).not.toHaveBeenCalled();
  });

  it("quien no vende (un auditor) tampoco lo ve", async () => {
    await renderDashboard(["pos:view", "products:read"]);
    await screen.findByTestId("dashboard-title");
    expect(screen.queryByTestId("seller-panel")).not.toBeInTheDocument();
    expect(mocked.getSession).not.toHaveBeenCalled();
  });
});
