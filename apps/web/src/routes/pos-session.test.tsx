import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import * as posApi from "../lib/pos/api";
import { createQueryClient } from "../lib/query-client";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

/**
 * F4-CASHBOX-03 — la UI del turno.
 *
 * Lo que se prueba acá no es que los botones existan: es que la pantalla diga
 * **desde qué almacén se está vendiendo** (deuda de F3-HOME-05) y que el
 * descuadre se VEA sin frenar el cierre.
 */
vi.mock("../lib/pos/api", () => ({
  getSession: vi.fn(),
  openSession: vi.fn(),
  getSessionTotals: vi.fn(),
  closeSession: vi.fn(),
}));
// `listScopedWarehouses` NO existe: el alcance se pide con
// `listWarehouses({ scoped: true })`. El mock la declaraba y nadie lo notaba
// porque ningún test la USABA — un mock de una función inexistente es una
// mentira que solo se descubre cuando alguien intenta apoyarse en ella.
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
}));

const mocked = vi.mocked(posApi);
const mockedWarehouses = vi.mocked(warehousesApi);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "cajero@demo.test",
  firstName: "Ana",
  locale: "es",
  permissions,
  tenant: {
    id: "t1",
    name: "Demo",
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
  },
});

const sesion = (overrides: Partial<posApi.CashboxSession> = {}): posApi.CashboxSession => ({
  id: "s1",
  warehouseId: "w1",
  status: "open",
  openedAt: "2026-08-21T15:00:00.000Z",
  closedAt: null,
  declaredCash: null,
  calculatedCash: null,
  cashDifference: null,
  closingNote: null,
  warehouse: { id: "w1", name: "Almacén Centro" },
  ...overrides,
});

async function renderRuta(path: string, permissions = ["pos:sell"]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
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
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().clearAuth();
  mockedWarehouses.listWarehouses.mockResolvedValue([
    { id: "w1", name: "Almacén Centro", isActive: true } as never,
  ]);
  mocked.getSessionTotals.mockResolvedValue({ totals: [] });
});

describe("/pos — la puerta del punto de venta", () => {
  /**
   * Un botón COBRAR que siempre falla es peor que no tenerlo: sin turno, la
   * pantalla ofrece ABRIRLO.
   */
  it("sin turno abierto ofrece abrirlo, no un carrito que no podría cobrar", async () => {
    mocked.getSession.mockResolvedValue({ session: null });

    await renderRuta("/pos");

    expect(await screen.findByTestId("open-session")).toBeInTheDocument();
    expect(screen.queryByTestId("session-bar")).not.toBeInTheDocument();
  });

  /**
   * ⚠ LA DEUDA DE F3-HOME-05. El vendedor tiene que saber de dónde está
   * descontando: quien rota entre sucursales puede vender media mañana contra
   * el inventario equivocado, y el error solo aparece al cuadrar.
   */
  it("con turno abierto, la barra dice DESDE QUÉ ALMACÉN se vende", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });

    await renderRuta("/pos");

    expect(await screen.findByTestId("session-warehouse")).toHaveTextContent("Almacén Centro");
  });

  it("abrir el turno llama al API y deja de ofrecer la apertura", async () => {
    mocked.getSession.mockResolvedValueOnce({ session: null });
    mocked.openSession.mockResolvedValue(sesion());
    mocked.getSession.mockResolvedValue({ session: sesion() });

    const user = await renderRuta("/pos");
    await user.click(await screen.findByRole("button", { name: /abrir turno/i }));

    await waitFor(() => expect(mocked.openSession).toHaveBeenCalled());
    expect(await screen.findByTestId("session-bar")).toBeInTheDocument();
  });

  /** El error del server NUNCA se traga — lección del confirm mudo de F3. */
  it("si el API rechaza la apertura, el motivo se ve", async () => {
    mocked.getSession.mockResolvedValue({ session: null });
    mocked.openSession.mockRejectedValue(
      Object.assign(new Error("Ya tienes un turno de caja abierto."), { status: 409 }),
    );

    const user = await renderRuta("/pos");
    await user.click(await screen.findByRole("button", { name: /abrir turno/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/turno de caja abierto/i);
  });

  it("sin `pos:sell` la pantalla no se abre", async () => {
    mocked.getSession.mockResolvedValue({ session: null });

    await renderRuta("/pos", ["inventory:read"]);

    expect(screen.queryByTestId("open-session")).not.toBeInTheDocument();
  });
});

describe("/pos/close — el arqueo", () => {
  it("muestra lo calculado POR MÉTODO, con su conteo de ventas", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });
    mocked.getSessionTotals.mockResolvedValue({
      totals: [
        { method: "cash", total: "150.00", count: 3 },
        { method: "card", total: "80.00", count: 1 },
        { method: "transfer", total: "0", count: 0 },
      ],
    });

    await renderRuta("/pos/close");

    expect(await screen.findByTestId("total-cash")).toHaveTextContent("150");
    expect(screen.getByTestId("total-card")).toHaveTextContent("80");
    expect(screen.getByText(/3 ventas/i)).toBeInTheDocument();
  });

  /**
   * ⚠ LO QUE MÁS IMPORTA DE ESTA PANTALLA. Bloquear el cierre obligaría al
   * cajero a "encontrar" el número que el sistema quiere — y lo encontraría,
   * escribiendo el calculado en vez de lo que contó.
   */
  it("un descuadre se VE y NO bloquea el botón de cerrar", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });
    mocked.getSessionTotals.mockResolvedValue({
      totals: [{ method: "cash", total: "150.00", count: 3 }],
    });

    const user = await renderRuta("/pos/close");
    await user.type(await screen.findByLabelText(/efectivo contado/i), "130");

    // El formato es el del tenant (MXN): lo que el cajero LEE, no el número crudo.
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("-$20.00");
    expect(screen.getByRole("button", { name: /cerrar turno/i })).toBeEnabled();
  });

  it("sin escribir lo contado, el botón espera", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });

    await renderRuta("/pos/close");

    expect(await screen.findByRole("button", { name: /cerrar turno/i })).toBeDisabled();
  });

  it("sin turno abierto no hay nada que cuadrar: ofrece abrirlo", async () => {
    mocked.getSession.mockResolvedValue({ session: null });

    await renderRuta("/pos/close");

    expect(await screen.findByTestId("open-session")).toBeInTheDocument();
  });
});
