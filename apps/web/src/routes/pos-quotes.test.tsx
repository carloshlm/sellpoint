import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { useCartStore } from "@/stores/cart.store";
import { createI18n } from "../i18n";
import * as posApi from "../lib/pos/api";
import { createQueryClient } from "../lib/query-client";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

/**
 * F4-QUOTE-03 y F4-QUOTE-04 — cotizar y cargar.
 *
 * Las dos reglas que se protegen: **cotizar no exige turno de caja** —es
 * responder "¿cuánto me sale?", no una operación— y **al cargarla, lo que
 * cambió se VE antes de cobrar**: los precios se releen del catálogo y la
 * disponibilidad se resuelve contra el almacén del turno, que puede no ser el
 * de la cotización.
 */
vi.mock("../lib/pos/api", () => ({
  getSession: vi.fn(),
  openSession: vi.fn(),
  getSessionTotals: vi.fn(),
  closeSession: vi.fn(),
  lookup: vi.fn(),
  createSale: vi.fn(),
  listSales: vi.fn(),
  cancelSale: vi.fn(),
  printTicket: vi.fn(),
  createQuote: vi.fn(),
  listQuotes: vi.fn(),
  cancelQuote: vi.fn(),
  getQuoteForSale: vi.fn(),
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

const PIEZA: posApi.LookupPresentation = {
  id: "pres-pieza",
  name: "Pieza",
  factor: "1",
  price: "15.00",
  barcode: null,
  isDefaultSale: true,
  allowFractionalInput: false,
};

const AGUA: posApi.LookupProductItem = {
  type: "product",
  matchedBy: "text",
  id: "prod-agua",
  sku: "AGUA",
  name: "Agua mineral",
  baseUnit: "unit",
  isComposite: false,
  available: "50",
  expired: "0",
  presentations: [PIEZA],
  matchedPresentationId: null,
};

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "cajero@demo.test",
  firstName: "Ana",
  locale: "es",
  defaultWarehouseId: "w1",
  permissions,
  tenant: {
    id: "t1",
    name: "Demo",
    legalName: null,
    taxId: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
  },
});

const sesion = (): posApi.CashboxSession => ({
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
});

const cotizacion = (overrides: Partial<posApi.QuoteRow> = {}): posApi.QuoteRow => ({
  id: "quote-1",
  folio: "COT-000001",
  warehouseId: "w1",
  status: "open",
  total: "30.00",
  note: null,
  createdAt: "2026-08-21T16:00:00.000Z",
  lines: [],
  warehouse: { id: "w1", name: "Almacén Centro" },
  author: { id: "u1", name: "Ana Pérez" },
  ...overrides,
});

const paraVender = (overrides: Partial<posApi.QuoteForSale> = {}): posApi.QuoteForSale => ({
  id: "quote-1",
  folio: "COT-000001",
  status: "open",
  warehouseId: "w1",
  note: null,
  quotedTotal: "30.00",
  lines: [
    {
      lineNo: 1,
      productId: "prod-agua",
      serviceId: null,
      presentationId: PIEZA.id,
      description: "Agua mineral — Pieza",
      quantity: "2",
      quotedUnitPrice: "15",
      unitPrice: "15",
      unavailable: false,
      shortfall: null,
      item: AGUA,
    },
  ],
  ...overrides,
});

async function renderRuta(path: string, permissions: string[]) {
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
}

describe("Cotización (F4-QUOTE-03 / F4-QUOTE-04)", () => {
  /**
   * La paginación de VERDAD (Carlos, 2026-08-25): el server siempre recortó a
   * 20 y la pantalla no lo decía — la cotización 21 desaparecía en silencio.
   */
  describe("la paginación (2026-08-25)", () => {
    it("con más de una página, pasar de página consulta al servidor", async () => {
      mocked.listQuotes.mockResolvedValue({
        rows: [cotizacion()],
        total: 45,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/pos/quotes", ["pos:quote"]);
      await screen.findByText("COT-000001");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      await waitFor(() =>
        expect(mocked.listQuotes).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
      );
    });

    it("cambiar el filtro de estado vuelve a la página 1", async () => {
      mocked.listQuotes.mockResolvedValue({
        rows: [cotizacion()],
        total: 45,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/pos/quotes", ["pos:quote"]);
      await screen.findByText("COT-000001");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /siguiente/i }));
      await user.selectOptions(screen.getByLabelText(/estado/i), "open");

      await waitFor(() =>
        expect(mocked.listQuotes).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
      );
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useCartStore.getState().clear();
    mocked.getSession.mockResolvedValue({ session: null });
    mocked.getSessionTotals.mockResolvedValue({ totals: [] });
    mocked.listQuotes.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    mockedWarehouses.listWarehouses.mockResolvedValue([
      { id: "w1", name: "Almacén Centro", isActive: true },
    ] as never);
  });

  describe("el nav", () => {
    it("con `pos:quote` aparece «Cotización»", async () => {
      await renderRuta("/pos/quotes", ["pos:quote"]);

      const nav = await screen.findByRole("group", { name: "Punto de venta" });
      expect(within(nav).getByLabelText("Cotización")).toBeInTheDocument();
    });

    /**
     * ⚠ La regla del nav de F2: cada item con SU permiso. Quien cobra no
     * necesariamente cotiza.
     */
    it("sin `pos:quote` NO aparece, aunque se pueda vender", async () => {
      await renderRuta("/pos", ["pos:sell"]);

      const nav = await screen.findByRole("group", { name: "Punto de venta" });
      expect(within(nav).queryByLabelText("Cotización")).not.toBeInTheDocument();
    });
  });

  describe("armar una cotización (F4-QUOTE-03)", () => {
    /**
     * ⚠ LA INVARIANTE DEL MÓDULO. Cotizar es responder "¿cuánto me sale?", y
     * eso pasa en el mostrador o por teléfono. La pantalla de venta ofrece
     * abrir turno cuando no hay; esta NO puede hacer eso.
     */
    it("se entra SIN turno abierto y no se pide abrirlo", async () => {
      await renderRuta("/pos/quotes/new", ["pos:quote"]);

      expect(await screen.findByTestId("quote-builder")).toBeInTheDocument();
      expect(screen.queryByTestId("open-session")).not.toBeInTheDocument();
    });

    it("sin líneas no deja generar", async () => {
      await renderRuta("/pos/quotes/new", ["pos:quote"]);
      await screen.findByTestId("quote-builder");

      expect(screen.getByRole("button", { name: "Generar cotización" })).toBeDisabled();
    });

    it("manda ids y cantidades y pinta el folio", async () => {
      mocked.createQuote.mockResolvedValue({
        id: "quote-1",
        folio: "COT-000007",
        warehouseId: "w1",
        status: "open",
        total: "30.00",
        note: null,
        createdAt: "2026-08-21T16:00:00.000Z",
        lines: [],
      });
      await renderRuta("/pos/quotes/new", ["pos:quote"]);
      await screen.findByTestId("quote-builder");
      useCartStore.getState().add(AGUA, { quantity: "2" });

      await userEvent.click(await screen.findByRole("button", { name: "Generar cotización" }));

      await waitFor(() => expect(mocked.createQuote).toHaveBeenCalledTimes(1));
      expect(mocked.createQuote.mock.calls[0]?.[0]?.lines).toEqual([
        { productId: "prod-agua", presentationId: PIEZA.id, quantity: 2 },
      ]);
      expect(await screen.findByTestId("quote-done")).toHaveTextContent("COT-000007");
    });

    /**
     * Un carrito que sobrevive a la cotización terminaría cobrado por segunda
     * vez desde la pantalla de venta, ya sin vínculo al folio.
     */
    it("generada la cotización, el carrito queda vacío", async () => {
      mocked.createQuote.mockResolvedValue({
        id: "quote-1",
        folio: "COT-000007",
        warehouseId: "w1",
        status: "open",
        total: "30.00",
        note: null,
        createdAt: "2026-08-21T16:00:00.000Z",
        lines: [],
      });
      await renderRuta("/pos/quotes/new", ["pos:quote"]);
      await screen.findByTestId("quote-builder");
      useCartStore.getState().add(AGUA, { quantity: "2" });
      await userEvent.click(await screen.findByRole("button", { name: "Generar cotización" }));

      await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(0));
    });

    it("un rechazo del servidor se pinta, no deja el botón muerto", async () => {
      mocked.createQuote.mockRejectedValue({
        statusCode: 422,
        message: "«AGUA» no tiene existencia vendible en este almacén.",
        error: "Unprocessable Entity",
        code: "pos.product_not_available",
      });
      await renderRuta("/pos/quotes/new", ["pos:quote"]);
      await screen.findByTestId("quote-builder");
      useCartStore.getState().add(AGUA, { quantity: "2" });

      await userEvent.click(await screen.findByRole("button", { name: "Generar cotización" }));

      expect(await screen.findByText(/no tiene existencia vendible/)).toBeInTheDocument();
    });
  });

  describe("cargar en la venta (F4-QUOTE-04)", () => {
    async function abrirPanel(quote = paraVender()) {
      mocked.getSession.mockResolvedValue({ session: sesion() });
      mocked.lookup.mockResolvedValue({
        warehouseId: "w1",
        exact: true,
        items: [
          {
            type: "quote",
            matchedBy: "quote",
            id: quote.id,
            folio: quote.folio,
            status: "open",
            total: quote.quotedTotal,
            lineCount: quote.lines.length,
          },
        ],
      });
      mocked.getQuoteForSale.mockResolvedValue(quote);

      await renderRuta("/pos", ["pos:sell"]);
      await userEvent.type(await screen.findByLabelText("Buscar"), "COT-000001");
      return screen.findByTestId("quote-load-panel");
    }

    /**
     * ⚠ El folio abre una CONFIRMACIÓN, no un volcado directo. Es el único
     * punto del POS donde lo que el cliente tiene en la mano y lo que se va a
     * cobrar pueden no coincidir.
     */
    it("teclear el folio COT abre el panel de confirmación", async () => {
      await abrirPanel();

      expect(screen.getByTestId("quote-load-panel")).toBeInTheDocument();
      expect(useCartStore.getState().lines).toHaveLength(0);
    });

    /**
     * ⚠ La cotización NO congela precios. El del papel se muestra TACHADO, no
     * se esconde: es lo que deja explicar la diferencia en vez de discutirla.
     */
    it("un precio cambiado muestra el nuevo Y el del papel", async () => {
      const quote = paraVender();
      quote.lines[0] = { ...quote.lines[0]!, unitPrice: "20", quotedUnitPrice: "15" };
      await abrirPanel(quote);

      const linea = screen.getByTestId("quote-line-1");
      expect(within(linea).getByText(/\$20\.00/)).toBeInTheDocument();
      expect(screen.getByTestId("quote-old-1")).toHaveTextContent("$15.00");
    });

    it("un faltante viene MARCADO, no escondido", async () => {
      const quote = paraVender();
      quote.lines[0] = { ...quote.lines[0]!, shortfall: "2" };
      await abrirPanel(quote);

      expect(within(screen.getByTestId("quote-line-1")).getByRole("alert")).toHaveTextContent(
        /Faltan 2/,
      );
    });

    it("confirmar vuelca al carrito Y recuerda el folio para el vínculo", async () => {
      await abrirPanel();

      await userEvent.click(screen.getByRole("button", { name: "Cargar al carrito" }));

      await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
      expect(useCartStore.getState().lines[0]?.quantity).toBe("2");
      // Sin esto la venta no marcaría la cotización como `loaded` y el papel
      // podría cobrarse de nuevo.
      expect(useCartStore.getState().quoteId).toBe("quote-1");
    });

    /**
     * ⚠ Un folio ya cargado no es un "no existe": quien tiene el papel en la
     * mano necesita saber cuál de las dos cosas pasó.
     */
    it("un folio ya cargado muestra el error del servidor", async () => {
      mocked.getSession.mockResolvedValue({ session: sesion() });
      mocked.lookup.mockResolvedValue({
        warehouseId: "w1",
        exact: true,
        items: [
          {
            type: "quote",
            matchedBy: "quote",
            id: "quote-1",
            folio: "COT-000001",
            status: "loaded",
            total: "30.00",
            lineCount: 1,
          },
        ],
      });
      mocked.getQuoteForSale.mockRejectedValue({
        statusCode: 409,
        message: "Esa cotización ya se usó o se canceló.",
        error: "Conflict",
        code: "pos.quote_not_open",
      });

      await renderRuta("/pos", ["pos:sell"]);
      await userEvent.type(await screen.findByLabelText("Buscar"), "COT-000001");

      expect(await screen.findByText(/ya se usó o se canceló/)).toBeInTheDocument();
      expect(useCartStore.getState().lines).toHaveLength(0);
    });

    it("una línea que ya no se vende no se carga, y las demás sí", async () => {
      const quote = paraVender();
      quote.lines = [
        { ...quote.lines[0]!, lineNo: 1 },
        {
          ...quote.lines[0]!,
          lineNo: 2,
          description: "Producto retirado",
          unitPrice: null,
          unavailable: true,
          item: null,
        },
      ];
      await abrirPanel(quote);

      await userEvent.click(screen.getByRole("button", { name: "Cargar al carrito" }));

      await waitFor(() => expect(useCartStore.getState().lines).toHaveLength(1));
    });
  });
});

/**
 * ── FILTRO POR RANGO DE FECHAS (2026-08-24, pedido de Carlos) ─────────────
 *
 * El mismo `DateRangeFilter` que ya usan Entradas, Salidas e Inventario: son
 * cuatro pantallas hoy y los reportes de F5 pedirán la quinta. Copiarlo sería
 * garantizar que una se quede atrás y mienta sin ponerse roja.
 *
 * Ninguna de las dos arranca acotada, a diferencia del Kardex: acá se entra a
 * buscar «la venta que no cuadra» o «la cotización de la semana pasada», y un
 * rango por defecto escondería justo lo que se busca.
 */
describe("Cotizaciones: rango de fechas (F4-QUOTE-01)", () => {
  it("pinta el filtro de rango de fechas", async () => {
    await renderRuta("/pos/quotes", ["pos:quote"]);

    expect(await screen.findByLabelText(/desde/i)).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(/hasta/i)).toHaveAttribute("type", "date");
  });

  it("elegir un rango lo manda al API", async () => {
    await renderRuta("/pos/quotes", ["pos:quote"]);
    await screen.findByLabelText(/desde/i);

    fireEvent.change(screen.getByLabelText(/desde/i), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/hasta/i), { target: { value: "2026-08-24" } });

    await waitFor(() => {
      expect(mocked.listQuotes).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-08-01", to: "2026-08-24" }),
      );
    });
  });

  it("sin rango puesto, no viajan fechas vacías", async () => {
    await renderRuta("/pos/quotes", ["pos:quote"]);
    await screen.findByLabelText(/desde/i);

    // Mandar `from: ""` haría que el API rechace la consulta por formato.
    const enviado = mocked.listQuotes.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(enviado.from).toBeUndefined();
    expect(enviado.to).toBeUndefined();
  });
});
