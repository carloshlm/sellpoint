import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createQueryClient } from "../query-client";
import * as dashboardApi from "./api";
import { PANEL_STALE_TIME_MS, useDashboardPayments } from "./hooks";

vi.mock("./api", () => ({
  getDashboardKpis: vi.fn(),
  getDashboardSeries: vi.fn(),
  getDashboardProducts: vi.fn(),
  getDashboardInventory: vi.fn(),
  getDashboardPayments: vi.fn(),
  getDashboardControl: vi.fn(),
}));

const mocked = vi.mocked(dashboardApi);

const PAGOS: dashboardApi.DashboardPayments = {
  methods: [{ method: "cash", total: "620.00", pct: 62 }],
};

/** Un componente que lee las formas de pago del mes, como los avisos y el donut. */
function Lector() {
  useDashboardPayments("month", true);
  return null;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * F10-PEND-05 — el donut se monta tarde (sus gráficas van en `lazy`), cuando
 * los avisos ya tienen las formas de pago del mes. Con `staleTime` en 0, el
 * dato ya era viejo y el donut lo volvía a pedir: dos `payment-methods` en
 * cada carga del panel.
 */
describe("los hooks del panel", () => {
  beforeEach(() => {
    mocked.getDashboardPayments.mockReset();
    mocked.getDashboardPayments.mockResolvedValue(PAGOS);
  });

  it("quien se monta tarde en la misma carga usa lo que ya llegó, sin pedirlo otra vez", async () => {
    const client = createQueryClient();
    const arbol = (lectores: number) => (
      <QueryClientProvider client={client}>
        {Array.from({ length: lectores }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: lectores idénticos, solo cuenta cuántos hay
          <Lector key={i} />
        ))}
      </QueryClientProvider>
    );
    const { rerender } = render(arbol(1));
    await waitFor(() =>
      expect(client.getQueryState(["dashboard", "payments", "month", null])?.status).toBe(
        "success",
      ),
    );

    rerender(arbol(2));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(mocked.getDashboardPayments).toHaveBeenCalledTimes(1);
  });

  it("pasado ese rato, volver al panel lo pide de nuevo: no muestra datos viejos", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-23T12:00:00Z") });
    const client = createQueryClient();
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Lector />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(mocked.getDashboardPayments).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(client.getQueryState(["dashboard", "payments", "month", null])?.status).toBe(
        "success",
      ),
    );
    unmount();

    vi.setSystemTime(new Date(Date.now() + PANEL_STALE_TIME_MS + 1));
    render(
      <QueryClientProvider client={client}>
        <Lector />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocked.getDashboardPayments).toHaveBeenCalledTimes(2));
  });
});
