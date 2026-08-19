import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { KardexTab } from "@/components/inventory/kardex-tab";
import { StockTab } from "@/components/inventory/stock-tab";
import { createI18n } from "../i18n";
import type { KardexRow, StockSummary } from "../lib/inventory/kardex-api";
import * as kardexApi from "../lib/inventory/kardex-api";
import { createQueryClient } from "../lib/query-client";
import * as warehousesApi from "../lib/warehouses/api";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-KARDEX-02/05 — las dos tabs del detalle de producto.
 *
 * El kardex existe por `balanceAfter`: la lista de movimientos la da
 * cualquiera, pero el saldo que quedó después de cada línea es lo que permite
 * auditar. Y el stock por almacén muestra los almacenes EN CERO, porque
 * "nunca llegó acá" y "se agotó acá" piden decisiones distintas.
 */
vi.mock("../lib/inventory/kardex-api", () => ({
  getKardex: vi.fn(),
  getStock: vi.fn(),
  getInTransit: vi.fn(),
  updateLot: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));

const mocked = vi.mocked(kardexApi);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  locale: "es",
  permissions,
  tenant: {
    id: "tenant-1",
    name: "Acme",
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

const movimiento = (overrides: Partial<KardexRow> = {}): KardexRow => ({
  id: "m1",
  createdAt: "2026-08-19T10:00:00.000Z",
  direction: "entry",
  reasonCode: "invoice",
  reasonNote: null,
  reference: "F-8891",
  quantity: "50",
  unitCost: "15.50",
  location: null,
  balanceAfter: "50",
  document: { id: "doc-1", folio: "ENT-000042", type: "entry", status: "confirmed" },
  warehouse: { id: "w1", name: "Central" },
  linkedWarehouse: null,
  presentation: null,
  lot: null,
  parentProduct: null,
  createdBy: { id: "u9", name: "María López" },
  ...overrides,
});

const resumen = (overrides: Partial<StockSummary> = {}): StockSummary => ({
  isComposite: false,
  rows: [
    { warehouseId: "w1", name: "Central", quantity: "50", updatedAt: "2026-08-19T10:00:00.000Z" },
    { warehouseId: "w2", name: "Norte", quantity: "0", updatedAt: null },
  ],
  total: "50",
  stockMin: "0",
  belowMin: false,
  baseUnit: "unit",
  ...overrides,
});

/**
 * Las tabs usan `<Link>` de TanStack Router, que exige un `RouterProvider`
 * arriba. Se monta un router mínimo cuya raíz ES el componente bajo prueba:
 * más honesto que stubbear `Link`, porque así el `href` que se verifica es el
 * que el router genera de verdad.
 */
function renderTab(node: React.ReactNode, permissions: string[] = ["inventory:read"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const rootRoute = createRootRoute({ component: () => <>{node}</> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router as never} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return userEvent.setup();
}

beforeEach(() => {
  mocked.getKardex.mockReset();
  mocked.getStock.mockReset();
  mocked.getInTransit.mockReset();
  mocked.updateLot.mockReset();
  vi.mocked(warehousesApi.listWarehouses).mockReset();
  vi.mocked(warehousesApi.listWarehouses).mockResolvedValue([
    { id: "w1", name: "Central", address: null, isActive: true },
    { id: "w2", name: "Norte", address: null, isActive: true },
  ]);
  mocked.getKardex.mockResolvedValue({
    rows: [movimiento()],
    total: 1,
    page: 1,
    pageSize: 50,
    isComposite: false,
  });
  mocked.getStock.mockResolvedValue(resumen());
  mocked.getInTransit.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Tab Kardex (F3-KARDEX-02)", () => {
  it("muestra el movimiento con su folio y el saldo que quedó", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} />);

    const fila = (await screen.findByText("ENT-000042")).closest("tr") as HTMLElement;

    expect(within(fila).getByText("50")).toBeInTheDocument();
    expect(within(fila).getByTestId("balance-after")).toHaveTextContent("50");
    expect(within(fila).getByText("María López")).toBeInTheDocument();
  });

  it("el folio enlaza al documento", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} />);

    const enlace = await screen.findByRole("link", { name: "ENT-000042" });

    expect(enlace).toHaveAttribute("href", "/movements/documents/doc-1");
  });

  it("cambiar el motivo dispara el request con ese filtro", async () => {
    const user = renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} />);
    await screen.findByText("ENT-000042");

    await user.selectOptions(screen.getByLabelText(/motivo/i), "loss");

    await waitFor(() => {
      expect(mocked.getKardex).toHaveBeenLastCalledWith(
        "p1",
        expect.objectContaining({ reasonCode: "loss" }),
      );
    });
  });

  /** Las columnas de lote solo estorban en un producto que no los maneja. */
  it("sin lotes no muestra la columna de lote", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} />);

    await screen.findByText("ENT-000042");
    expect(screen.queryByRole("columnheader", { name: /lote/i })).not.toBeInTheDocument();
  });

  it("con lotes sí la muestra", async () => {
    mocked.getKardex.mockResolvedValue({
      rows: [movimiento({ lot: { id: "l1", lotCode: "st10", expiresAt: "2026-07-01" } })],
      total: 1,
      page: 1,
      pageSize: 50,
      isComposite: false,
    });
    renderTab(<KardexTab productId="p1" tracksLots={true} isComposite={false} />);

    await screen.findByText("ENT-000042");
    expect(screen.getByRole("columnheader", { name: /lote/i })).toBeInTheDocument();
    expect(screen.getByText("st10")).toBeInTheDocument();
  });

  /**
   * Un compuesto no tiene movimientos propios: se arma al consumirlo. Mostrar
   * una tabla vacía haría pensar que nunca se movió.
   */
  it("un compuesto explica que no tiene kardex propio", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={true} />);

    expect(await screen.findByText(/no tienen kardex propio/i)).toBeInTheDocument();
    expect(mocked.getKardex).not.toHaveBeenCalled();
  });

  it("sin movimientos muestra un estado vacío", async () => {
    mocked.getKardex.mockResolvedValue({
      rows: [],
      total: 0,
      page: 1,
      pageSize: 50,
      isComposite: false,
    });
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} />);

    expect(await screen.findByText(/sin movimientos/i)).toBeInTheDocument();
  });
});

describe("Tab Stock por almacén (F3-KARDEX-05)", () => {
  it("lista los almacenes, incluidos los que están en cero", async () => {
    renderTab(<StockTab productId="p1" />);

    expect(await screen.findByText("Central")).toBeInTheDocument();
    // Norte está en cero y aparece igual: "nunca llegó acá" y "se agotó acá"
    // piden decisiones distintas.
    expect(screen.getByText("Norte")).toBeInTheDocument();
  });

  it("marca el total bajo mínimo", async () => {
    mocked.getStock.mockResolvedValue(resumen({ total: "5", stockMin: "100", belowMin: true }));
    renderTab(<StockTab productId="p1" />);

    expect(await screen.findByTestId("below-min")).toBeInTheDocument();
  });

  it("sin estar bajo mínimo no hay badge", async () => {
    renderTab(<StockTab productId="p1" />);

    await screen.findByText("Central");
    expect(screen.queryByTestId("below-min")).not.toBeInTheDocument();
  });

  /** El primero FEFO es el que el sistema va a descontar: se dice. */
  it("con lotes marca el que se descuenta primero y el que vence pronto", async () => {
    mocked.getStock.mockResolvedValue(
      resumen({
        rows: [
          {
            warehouseId: "w1",
            name: "Central",
            quantity: "8",
            updatedAt: "2026-08-19T10:00:00.000Z",
            lots: [
              {
                lotId: "l1",
                lotCode: "st10",
                expiresAt: "2026-07-01",
                location: "A-1",
                quantity: "3",
                expiringSoon: true,
              },
              {
                lotId: "l2",
                lotCode: "st30",
                expiresAt: "2027-01-01",
                location: "B-2",
                quantity: "5",
                expiringSoon: false,
              },
            ],
          },
        ],
      }),
    );
    renderTab(<StockTab productId="p1" />);

    const primero = (await screen.findByText("st10")).closest("tr") as HTMLElement;
    const segundo = screen.getByText("st30").closest("tr") as HTMLElement;

    expect(within(primero).getByTestId("fefo-first")).toBeInTheDocument();
    expect(within(primero).getByTestId("expiring-soon")).toBeInTheDocument();
    expect(within(segundo).queryByTestId("fefo-first")).not.toBeInTheDocument();
  });

  it("muestra lo que está en tránsito", async () => {
    mocked.getInTransit.mockResolvedValue({
      rows: [
        {
          productId: "p1",
          sku: "PAR-500",
          name: "Paracetamol",
          baseUnit: "unit",
          quantity: "12",
          transfers: 2,
        },
      ],
    });
    renderTab(<StockTab productId="p1" />);

    const enTransito = await screen.findByTestId("in-transit");

    expect(enTransito).toHaveTextContent("12");
  });

  it("un compuesto muestra unidades armables y no la tabla", async () => {
    mocked.getStock.mockResolvedValue(
      resumen({
        isComposite: true,
        rows: [],
        availability: {
          units: 5,
          limitingComponent: { productId: "p9", sku: "AZU-1", name: "Azúcar" },
        },
      }),
    );
    renderTab(<StockTab productId="p1" />);

    expect(await screen.findByText(/se pueden armar 5/i)).toBeInTheDocument();
    expect(screen.getByText(/AZU-1/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("sin `inventory:movement` no ofrece registrar movimientos", async () => {
    renderTab(<StockTab productId="p1" />, ["inventory:read"]);

    await screen.findByText("Central");
    expect(screen.queryByRole("link", { name: /registrar entrada/i })).not.toBeInTheDocument();
  });

  it("con `inventory:movement` sí", async () => {
    renderTab(<StockTab productId="p1" />, ["inventory:read", "inventory:movement"]);

    expect(await screen.findByRole("link", { name: /registrar entrada/i })).toBeInTheDocument();
  });
});

/**
 * F3-LOTS-04 — corregir un lote desde la tab de stock.
 *
 * **Cambiar la caducidad reordena qué se vende primero.** Por eso la pantalla
 * lo advierte ANTES de guardar: quien corrige un typo en un código no está
 * haciendo lo mismo que quien corrige una fecha, aunque el formulario sea el
 * mismo.
 */
describe("Editar un lote (F3-LOTS-04)", () => {
  const conLotes = () =>
    resumen({
      rows: [
        {
          warehouseId: "w1",
          name: "Central",
          quantity: "5",
          updatedAt: "2026-08-19T10:00:00.000Z",
          lots: [
            {
              lotId: "l1",
              lotCode: "st10",
              expiresAt: "2027-01-01",
              location: "A-1",
              quantity: "5",
              expiringSoon: false,
            },
          ],
        },
      ],
    });

  it("sin `inventory:movement` no ofrece editar", async () => {
    mocked.getStock.mockResolvedValue(conLotes());
    renderTab(<StockTab productId="p1" />, ["inventory:read"]);

    await screen.findByText("st10");
    expect(screen.queryByRole("button", { name: /editar lote/i })).not.toBeInTheDocument();
  });

  it("cambiar solo el código guarda sin preguntar", async () => {
    mocked.getStock.mockResolvedValue(conLotes());
    mocked.updateLot.mockResolvedValue({ id: "l1", lotCode: "L-0001", expiresAt: "2027-01-01" });
    const user = renderTab(<StockTab productId="p1" />, ["inventory:read", "inventory:movement"]);
    await screen.findByText("st10");

    await user.click(screen.getByRole("button", { name: /editar lote/i }));
    const codigo = await screen.findByLabelText(/código/i);
    await user.clear(codigo);
    await user.type(codigo, "L-0001");
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => {
      expect(mocked.updateLot).toHaveBeenCalledWith("p1", "l1", { lotCode: "L-0001" });
    });
    // Un typo en el código no cambia de dónde sale la mercancía: no hay
    // por qué frenar a nadie con un diálogo.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  /** Cambiar la fecha SÍ pregunta: reordena de qué partida sale la próxima venta. */
  it("cambiar la caducidad advierte antes de guardar", async () => {
    mocked.getStock.mockResolvedValue(conLotes());
    mocked.updateLot.mockResolvedValue({ id: "l1", lotCode: "st10", expiresAt: "2026-06-01" });
    const user = renderTab(<StockTab productId="p1" />, ["inventory:read", "inventory:movement"]);
    await screen.findByText("st10");

    await user.click(screen.getByRole("button", { name: /editar lote/i }));
    const fecha = await screen.findByLabelText(/caducidad/i);
    await user.clear(fecha);
    await user.type(fecha, "2026-06-01");
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/se vende primero/i)).toBeInTheDocument();
    // Todavía no se guardó nada.
    expect(mocked.updateLot).not.toHaveBeenCalled();

    await user.click(within(dialogo).getByRole("button", { name: /cambiar la caducidad/i }));

    await waitFor(() => {
      expect(mocked.updateLot).toHaveBeenCalledWith("p1", "l1", { expiresAt: "2026-06-01" });
    });
  });

  it("un código repetido se explica sobre el formulario", async () => {
    mocked.getStock.mockResolvedValue(conLotes());
    // El filtro del API devuelve el mensaje YA traducido (mismo contrato que
    // `fieldErrorsOf`): el mock lo replica en vez de mandar solo el código.
    mocked.updateLot.mockRejectedValue({
      statusCode: 409,
      code: "inventory.lot_code_taken",
      message: "Ese código de lote ya lo usa otro lote de este producto.",
    });
    const user = renderTab(<StockTab productId="p1" />, ["inventory:read", "inventory:movement"]);
    await screen.findByText("st10");

    await user.click(screen.getByRole("button", { name: /editar lote/i }));
    const codigo = await screen.findByLabelText(/código/i);
    await user.clear(codigo);
    await user.type(codigo, "repetido");
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/ya lo usa otro lote/i);
  });
});
