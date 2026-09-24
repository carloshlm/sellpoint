import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
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
  listPosWarehouses: vi.fn(),
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

const demoUser = (permissions: string[], extra: Partial<AuthUser> = {}): AuthUser =>
  buildAuthUser({
    email: "cajero@demo.test",
    permissions,
    tenant: buildTenantBlock({ id: "t1", name: "Demo" }),
    ...extra,
  });

const sesion = (overrides: Partial<posApi.CashboxSession> = {}): posApi.CashboxSession => ({
  id: "s1",
  warehouseId: "w1",
  status: "open",
  openedAt: "2026-08-21T15:00:00.000Z",
  closedAt: null,
  openingCash: "0",
  declaredCash: null,
  calculatedCash: null,
  cashDifference: null,
  closingNote: null,
  warehouse: { id: "w1", name: "Almacén Centro" },
  ...overrides,
});

async function renderRuta(path: string, permissions = ["pos:sell"], extra: Partial<AuthUser> = {}) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions, extra));
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
  mocked.listPosWarehouses.mockResolvedValue([{ id: "w1", name: "Almacén Centro" }]);
  mocked.getSessionTotals.mockResolvedValue({
    totals: [],
    cashExpenses: { total: "0", count: 0 },
    openingCash: "0",
    expectedCash: "0",
  });
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

  /**
   * F10-MANFIX-16 — la barra decía «08:45» y el panel del vendedor «08:45
   * a.m.» para la misma apertura. Las dos usan ahora el formato de hora de la
   * app, en el reloj del negocio (el mismo del reporte de cierres de turno).
   */
  it("la barra dice desde qué hora, con el formato de hora de la app", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });

    await renderRuta("/pos");

    // 15:00 UTC son las 9:00 en la Ciudad de México, la zona del negocio demo.
    const barra = await screen.findByTestId("session-bar");
    expect(barra).toHaveTextContent("Turno abierto desde 9:00");
    expect(barra).not.toHaveTextContent(/a\.\s?m\.|p\.\s?m\./);
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
      Object.assign(new Error("Ya tienes un turno abierto."), { status: 409 }),
    );

    const user = await renderRuta("/pos");
    await user.click(await screen.findByRole("button", { name: /abrir turno/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/turno abierto/i);
  });

  /**
   * F10-MANFIX-08 — la primera pantalla del día del cajero. El rol de fábrica
   * Seller no tiene `warehouses:read`: la lista de inventario le responde 403
   * y «Abrir turno» decía «No hay sucursales disponibles», aunque el botón sí
   * abría. La caja trae su propia lista (`GET /pos/warehouses`, con
   * `pos:sell`), con su sucursal asignada ya elegida.
   */
  it("el cajero (Seller) ve su sucursal asignada ya elegida, no el aviso de que no hay", async () => {
    mocked.getSession.mockResolvedValue({ session: null });
    mocked.openSession.mockResolvedValue(sesion({ warehouseId: "w2" }));
    mocked.listPosWarehouses.mockResolvedValue([
      { id: "w1", name: "Almacén Centro" },
      { id: "w2", name: "Sucursal Norte" },
    ]);
    // Lo que el API le contesta a un Seller en la lista de inventario.
    mockedWarehouses.listWarehouses.mockRejectedValue(
      Object.assign(new Error("No tienes permiso."), { status: 403 }),
    );

    const user = await renderRuta(
      "/pos",
      ["pos:sell", "pos:quote", "pos:view", "products:read", "services:read"],
      { defaultWarehouseId: "w2" },
    );

    const selector = await screen.findByLabelText("Sucursal");
    await waitFor(() => expect(selector).toHaveValue("w2"));
    expect(within(selector).getByRole("option", { name: "Sucursal Norte" })).toBeInTheDocument();
    expect(screen.queryByText(/no hay sucursales disponibles/i)).not.toBeInTheDocument();
    // Ni siquiera la pide: sería un 403 en cada apertura.
    expect(mockedWarehouses.listWarehouses).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /abrir turno/i }));
    // Sin fondo escrito, no viaja: el turno abre en $0, como siempre.
    await waitFor(() => expect(mocked.openSession).toHaveBeenCalledWith({ warehouseId: "w2" }));
  });

  /**
   * F10-MANFIX-10 — el fondo inicial se escribe AL ABRIR: el efectivo con que
   * el cajón arranca para dar cambio. Es opcional (vacío = $0), se captura
   * como los demás importes y viaja con la apertura.
   */
  it("abrir con fondo inicial manda el importe junto con la sucursal", async () => {
    mocked.getSession.mockResolvedValue({ session: null });
    mocked.openSession.mockResolvedValue(sesion({ openingCash: "500" }));

    const user = await renderRuta("/pos");
    const selector = await screen.findByLabelText("Sucursal");
    await waitFor(() => expect(selector).toHaveValue("w1"));
    await user.type(screen.getByLabelText("Fondo inicial (opcional)"), "500");
    await user.click(screen.getByRole("button", { name: /abrir turno/i }));

    await waitFor(() =>
      expect(mocked.openSession).toHaveBeenCalledWith({ warehouseId: "w1", openingCash: 500 }),
    );
  });

  it("el fondo va con la moneda del negocio y dice para qué sirve", async () => {
    mocked.getSession.mockResolvedValue({ session: null });

    const user = await renderRuta("/pos");
    const fondo = await screen.findByLabelText("Fondo inicial (opcional)");
    const caja = fondo.parentElement as HTMLElement;
    expect(within(caja).getByText("$")).toBeInTheDocument();
    expect(within(caja).getByText("MXN")).toBeInTheDocument();
    expect(
      screen.getByText(
        "El efectivo con que empiezas para dar cambio. Se suma al efectivo esperado al cerrar.",
      ),
    ).toBeInTheDocument();

    await user.type(fondo, "500");
    await user.tab();
    expect(fondo).toHaveValue("500.00");
  });

  it("un fondo mal escrito se marca y no deja abrir el turno", async () => {
    mocked.getSession.mockResolvedValue({ session: null });

    const user = await renderRuta("/pos");
    await user.type(await screen.findByLabelText("Fondo inicial (opcional)"), "50,5");

    expect(screen.getByRole("alert")).toHaveTextContent("solo con números y punto decimal");
    expect(screen.getByRole("button", { name: /abrir turno/i })).toBeDisabled();
    expect(mocked.openSession).not.toHaveBeenCalled();
  });

  /**
   * Sin sucursales, el aviso de inventario le pedía «crear una» a quien no
   * puede: el cajero la PIDE, como en compras y gastos.
   */
  it("sin sucursales, el aviso le dice al cajero a quién pedirla, no que cree una", async () => {
    mocked.getSession.mockResolvedValue({ session: null });
    mocked.listPosWarehouses.mockResolvedValue([]);

    await renderRuta("/pos");

    expect(
      await screen.findByText(
        "No tienes una sucursal donde vender. Pídele a un administrador que te dé acceso a una.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/crea una/i)).not.toBeInTheDocument();
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
      cashExpenses: { total: "0", count: 0 },
      openingCash: "0",
      expectedCash: "150.00",
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
      cashExpenses: { total: "0", count: 0 },
      openingCash: "0",
      expectedCash: "150.00",
    });

    const user = await renderRuta("/pos/close");
    await user.type(await screen.findByLabelText(/efectivo contado/i), "130");

    // El formato es el del tenant (MXN): lo que el cajero LEE, no el número crudo.
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("-$20.00");
    expect(screen.getByRole("button", { name: /cerrar turno/i })).toBeEnabled();
  });

  /**
   * F9-EXP-10 — el gasto pagado del cajón NO es un faltante del cajero: la
   * diferencia se calcula contra el efectivo ESPERADO (ventas − gastos), y el
   * renglón de gastos lleva el signo menos a la vista.
   */
  it("con gastos del cajón, la diferencia se calcula contra el efectivo esperado", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });
    mocked.getSessionTotals.mockResolvedValue({
      totals: [{ method: "cash", total: "500.00", count: 2 }],
      cashExpenses: { total: "200.00", count: 1 },
      openingCash: "0",
      expectedCash: "300.00",
    });

    const user = await renderRuta("/pos/close");
    expect(await screen.findByTestId("total-cash-expenses")).toHaveTextContent("−$200.00");
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("$300.00");
    expect(screen.getByText(/1 gasto/)).toBeInTheDocument();
    // Las ventas en efectivo siguen diciendo 500: la resta es un renglón aparte.
    expect(screen.getByTestId("total-cash")).toHaveTextContent("500");

    await user.type(screen.getByLabelText(/efectivo contado/i), "300");
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("$0.00");
  });

  /**
   * F10-MANFIX-10 — el cajón que arrancó con cambio: el fondo tiene su
   * renglón, y la diferencia se calcula contra el esperado que manda el API
   * (fondo + ventas − gastos). Sin el fondo, un turno que abrió con $500
   * salía sobrando $500.
   */
  it("con fondo inicial, se ve su renglón y contar fondo + ventas cuadra", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion({ openingCash: "500" }) });
    mocked.getSessionTotals.mockResolvedValue({
      totals: [{ method: "cash", total: "150.00", count: 3 }],
      cashExpenses: { total: "0", count: 0 },
      openingCash: "500",
      expectedCash: "650",
    });

    const user = await renderRuta("/pos/close");
    // Las ventas en efectivo siguen diciendo 150: el fondo es un renglón aparte.
    expect(await screen.findByTestId("total-cash")).toHaveTextContent("150");
    const fondo = screen.getByTestId("opening-cash");
    expect(fondo).toHaveTextContent("$500.00");
    expect(fondo.parentElement).toHaveTextContent("Fondo inicial");
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("$650.00");

    await user.type(screen.getByLabelText(/efectivo contado/i), "650");
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("$0.00");
  });

  it("sin fondo, el renglón dice $0.00 y el esperado es el de siempre", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });
    mocked.getSessionTotals.mockResolvedValue({
      totals: [{ method: "cash", total: "150.00", count: 3 }],
      cashExpenses: { total: "0", count: 0 },
      openingCash: "0",
      expectedCash: "150.00",
    });

    await renderRuta("/pos/close");

    await screen.findByTestId("total-cash");
    expect(screen.getByTestId("opening-cash")).toHaveTextContent("$0.00");
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("$150.00");
  });

  /**
   * Carlos, 2026-09-08: el efectivo contado es un importe y se captura como
   * los demás — con la moneda a la vista y a dos decimales al salir. La
   * diferencia se sigue calculando en vivo mientras se teclea.
   */
  it("lo contado se captura con la moneda del negocio y queda a dos decimales al salir", async () => {
    mocked.getSession.mockResolvedValue({ session: sesion() });
    mocked.getSessionTotals.mockResolvedValue({
      totals: [{ method: "cash", total: "150.00", count: 3 }],
      cashExpenses: { total: "0", count: 0 },
      openingCash: "0",
      expectedCash: "150.00",
    });

    const user = await renderRuta("/pos/close");
    const contado = await screen.findByLabelText(/efectivo contado/i);
    const caja = contado.parentElement as HTMLElement;
    expect(within(caja).getByText("$")).toBeInTheDocument();
    expect(within(caja).getByText("MXN")).toBeInTheDocument();

    await user.type(contado, "130");
    // La diferencia no espera al blur: se ve mientras se teclea.
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("-$20.00");

    await user.tab();
    expect(contado).toHaveValue("130.00");
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("-$20.00");
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
