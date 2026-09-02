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
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
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
  downloadKardex: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));

const mocked = vi.mocked(kardexApi);

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
    monthlySalesGoal: null,
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
    {
      id: "w1",
      code: "ALM-001",
      name: "Central",
      address: null,
      phone: null,
      email: null,
      attributes: {},
      isActive: true,
      deactivationBlockedBy: null,
    },
    {
      id: "w2",
      code: "ALM-002",
      name: "Norte",
      address: null,
      phone: null,
      email: null,
      attributes: {},
      isActive: true,
      deactivationBlockedBy: null,
    },
  ]);
  mocked.getKardex.mockResolvedValue({
    rows: [movimiento()],
    total: 1,
    page: 1,
    pageSize: 50,
    isComposite: false,
  });
  mocked.getStock.mockResolvedValue(resumen());
  mocked.downloadKardex.mockResolvedValue(undefined);
  mocked.getInTransit.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Tab Kardex (F3-KARDEX-02)", () => {
  it("muestra el movimiento con su folio y el saldo que quedó", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    const fila = (await screen.findByText("ENT-000042")).closest("tr") as HTMLElement;

    expect(within(fila).getByText("50")).toBeInTheDocument();
    expect(within(fila).getByTestId("balance-after")).toHaveTextContent("50");
    expect(within(fila).getByText("María López")).toBeInTheDocument();
  });

  it("el folio enlaza al documento", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    const enlace = await screen.findByRole("link", { name: "ENT-000042" });

    expect(enlace).toHaveAttribute("href", "/movements/documents/doc-1");
  });

  /**
   * El orden de los filtros lo pidió Carlos (2026-08-24): primero se elige
   * DÓNDE y QUÉ tipo de movimiento —lo que acota de verdad la lista— y el
   * rango de fechas cierra. Antes las fechas abrían la barra, que es empezar
   * por el filtro más fino sobre el conjunto más grande.
   */
  it("los filtros van en orden: Almacén, Motivo, Movimiento y al final las fechas", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    const barra = (await screen.findByLabelText(/motivo/i)).closest("div.flex-wrap") as HTMLElement;
    const etiquetas = [...barra.querySelectorAll("label")].map((l) => l.textContent?.trim());

    expect(etiquetas).toEqual(["Almacén", "Motivo", "Movimiento", "Desde", "Hasta"]);
  });

  /**
   * F5-KDX-02 — exportar el kardex desde su propia pantalla.
   *
   * No hay pantalla nueva en Reportes: la tarjeta del hub enlaza acá. Duplicar
   * esta vista con otros filtros sería mantener dos que dicen lo mismo, y el
   * kardex necesita un producto elegido — que es justo lo que esta pantalla ya
   * resuelve.
   */
  describe("el export (F5-KDX-02)", () => {
    it("exporta CON los filtros que están puestos", async () => {
      const user = renderTab(
        <KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />,
      );
      await screen.findByText("ENT-000042");

      await user.selectOptions(screen.getByLabelText(/motivo/i), "loss");
      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() =>
        expect(mocked.downloadKardex).toHaveBeenCalledWith(
          "p1",
          expect.objectContaining({ reasonCode: "loss" }),
        ),
      );
    });

    /**
     * El export no pagina y su schema es `.strict()`: mandarle `page` responde
     * 400. Es el mismo bug que apareció en producción con los reportes de
     * stock y ventas (2026-08-24) — acá se fija antes de que pase.
     */
    it("NO manda la paginación de la pantalla", async () => {
      const user = renderTab(
        <KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />,
      );
      await screen.findByText("ENT-000042");

      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() => expect(mocked.downloadKardex).toHaveBeenCalled());
      const enviado = mocked.downloadKardex.mock.calls[0]?.[1] ?? {};
      expect(enviado).not.toHaveProperty("page");
      expect(enviado).not.toHaveProperty("pageSize");
    });

    it("un compuesto no ofrece exportar: no tiene kardex propio", async () => {
      renderTab(<KardexTab productId="p1" tracksLots={false} isComposite baseUnit="unit" />);

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /exportar/i })).not.toBeInTheDocument(),
      );
    });
  });

  /**
   * La paginación del kardex (2026-08-25): el server pagina a 50 y la pestaña
   * no tenía botones — un producto con más de 50 movimientos en el rango
   * perdía los excedentes sin aviso. Lo mitigaba el rango inicial de 30 días,
   * que es esconder el problema, no resolverlo.
   */
  describe("la paginación (2026-08-25)", () => {
    it("con más de una página, pasar de página consulta al servidor", async () => {
      mocked.getKardex.mockResolvedValue({
        rows: [movimiento()],
        total: 120,
        page: 1,
        pageSize: 50,
        isComposite: false,
      });
      const user = renderTab(
        <KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />,
      );
      await screen.findByText("ENT-000042");

      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      await waitFor(() =>
        expect(mocked.getKardex).toHaveBeenLastCalledWith(
          "p1",
          expect.objectContaining({ page: 2 }),
        ),
      );
    });

    it("cambiar un filtro vuelve a la página 1", async () => {
      mocked.getKardex.mockResolvedValue({
        rows: [movimiento()],
        total: 120,
        page: 1,
        pageSize: 50,
        isComposite: false,
      });
      const user = renderTab(
        <KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />,
      );
      await screen.findByText("ENT-000042");

      await user.click(screen.getByRole("button", { name: /siguiente/i }));
      await user.selectOptions(screen.getByLabelText(/motivo/i), "loss");

      await waitFor(() =>
        expect(mocked.getKardex).toHaveBeenLastCalledWith(
          "p1",
          expect.objectContaining({ page: 1 }),
        ),
      );
    });
  });

  it("cambiar el motivo dispara el request con ese filtro", async () => {
    const user = renderTab(
      <KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />,
    );
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
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

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
    renderTab(<KardexTab productId="p1" tracksLots={true} isComposite={false} baseUnit="unit" />);

    await screen.findByText("ENT-000042");
    expect(screen.getByRole("columnheader", { name: /lote/i })).toBeInTheDocument();
    expect(screen.getByText("st10")).toBeInTheDocument();
  });

  /**
   * Un compuesto no tiene movimientos propios: se arma al consumirlo. Mostrar
   * una tabla vacía haría pensar que nunca se movió.
   */
  it("un compuesto explica que no tiene kardex propio", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={true} baseUnit="unit" />);

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
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    expect(await screen.findByText(/sin movimientos/i)).toBeInTheDocument();
  });
});

/**
 * (3) Carlos: «cuando el movimiento de salida es por venta me aparece dos
 * veces el folio».
 *
 * El API pone `reference: folio` al crear los movimientos de una venta, y la
 * celda pinta el folio como ENLACE y la referencia como texto gris al lado —
 * así que el mismo `VTA-000003` salía duplicado. La referencia sigue siendo
 * útil cuando dice algo distinto (número de factura, remisión); lo que sobra
 * es repetir lo que el enlace ya dice.
 *
 * Se arregla en la VISTA y no en el API a propósito: así también quedan
 * limpios los movimientos YA guardados, que son los que Carlos está viendo.
 */
describe("Tab Kardex: la referencia (F3-KARDEX-02)", () => {
  it("no repite el folio cuando la referencia dice lo mismo", async () => {
    mocked.getKardex.mockResolvedValue({
      rows: [
        movimiento({
          reference: "VTA-000003",
          document: { id: "s1", folio: "VTA-000003", type: "exit", status: "confirmed" },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      isComposite: false,
    });
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    const celda = (await screen.findByRole("link", { name: "VTA-000003" })).closest("td");

    expect(celda?.textContent?.match(/VTA-000003/g)).toHaveLength(1);
  });

  it("una referencia DISTINTA sí se muestra: es dato, no ruido", async () => {
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    // El fixture trae folio ENT-000042 y referencia F-8891 (una factura).
    expect(await screen.findByText("F-8891")).toBeInTheDocument();
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

  /**
   * ── LA FILA DEL ALMACÉN SE DISTINGUE (2026-08-24, pedido de Carlos) ────
   *
   * Con varios almacenes y sus lotes intercalados, la tabla era una lista
   * plana donde «Almacén Sur» y «ST1» pesaban lo mismo. La fila del almacén
   * es un ENCABEZADO de grupo: banda con fondo y nombre en negrita; los
   * lotes cuelgan debajo, claros e indentados. Se fija por clases porque
   * jsdom no calcula estilos — lo que se protege es que el contraste exista.
   */
  it("la fila del almacén se ve como encabezado y la del lote no", async () => {
    mocked.getStock.mockResolvedValue(
      resumen({
        rows: [
          {
            warehouseId: "w1",
            name: "Central",
            quantity: "50",
            updatedAt: "2026-08-19T10:00:00.000Z",
            lots: [
              {
                lotId: "l1",
                lotCode: "ST1",
                quantity: "50",
                expiresAt: "2026-09-30",
                location: "",
                expired: false,
                expiringSoon: false,
              },
            ],
          },
        ],
      }),
    );
    renderTab(<StockTab productId="p1" />);

    const almacen = await screen.findByTestId("warehouse-row-w1");
    expect(almacen.className).toContain("bg-muted");
    expect(almacen.className).toContain("font-medium");

    // El lote NO comparte el tratamiento: el contraste es lo que agrupa.
    const lote = screen.getByText("ST1").closest("tr");
    expect(lote?.className ?? "").not.toContain("bg-muted");
    expect(lote?.className ?? "").not.toContain("font-medium");
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
                expired: false,
                expiringSoon: true,
              },
              {
                lotId: "l2",
                lotCode: "st30",
                expiresAt: "2027-01-01",
                location: "B-2",
                quantity: "5",
                expired: false,
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

  /**
   * Hallazgo de Carlos (2026-08-20): un lote YA VENCIDO se pintaba «Vence
   * pronto» en amarillo. Son dos cosas distintas y el color tiene que
   * distinguirlas — el vencido va en ROJO, porque FEFO lo despacha PRIMERO y
   * es justo el que alguien va a dejar salir creyendo que sirve.
   */
  it("un lote YA VENCIDO se marca distinto —y en rojo— que uno por vencer", async () => {
    mocked.getStock.mockResolvedValue(
      resumen({
        rows: [
          {
            warehouseId: "w1",
            name: "Central",
            quantity: "62",
            updatedAt: "2026-08-20T10:00:00.000Z",
            lots: [
              {
                lotId: "l1",
                lotCode: "cad12",
                expiresAt: "2026-08-01",
                location: "",
                quantity: "12",
                expired: true,
                expiringSoon: false,
              },
              {
                lotId: "l2",
                lotCode: "st1",
                expiresAt: "2026-08-23",
                location: "",
                quantity: "50",
                expired: false,
                expiringSoon: true,
              },
            ],
          },
        ],
      }),
    );
    renderTab(<StockTab productId="p1" />);

    const vencido = (await screen.findByText("cad12")).closest("tr") as HTMLElement;
    const porVencer = screen.getByText("st1").closest("tr") as HTMLElement;

    // El vencido dice VENCIDO, no "vence pronto".
    const marca = within(vencido).getByTestId("expired");
    expect(within(vencido).queryByTestId("expiring-soon")).not.toBeInTheDocument();
    // Y en rojo, no en amarillo: el color es la mitad del mensaje.
    expect(marca.className).toContain("destructive");

    // El que de verdad está por vencer conserva su aviso amarillo.
    expect(within(porVencer).getByTestId("expiring-soon")).toBeInTheDocument();
    expect(within(porVencer).queryByTestId("expired")).not.toBeInTheDocument();
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
              expired: false,
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

/**
 * Reportado por Carlos mirando el kardex de ADVIL: `+12.0000` y saldo
 * `262.0000` para un producto que se cuenta en piezas. El `.0000` no lo
 * decidía nadie — la columna de la base es `numeric(_,4)` y la pantalla
 * pintaba el string tal cual.
 *
 * La precisión es una propiedad de lo que se MIDE, no del número que salió
 * hoy: piezas no tienen mitades, kilos sí.
 */
describe("Los decimales los decide la unidad (F3-KARDEX)", () => {
  const conMovimiento = () => {
    mocked.getKardex.mockResolvedValue({
      rows: [movimiento({ quantity: "12.0000", balanceAfter: "262.0000" })],
      total: 1,
      page: 1,
      pageSize: 50,
      isComposite: false,
    });
    mocked.getStock.mockResolvedValue(resumen());
    mocked.downloadKardex.mockResolvedValue(undefined);
    mocked.getInTransit.mockResolvedValue({ rows: [] });
  };

  it("un producto en piezas no muestra decimales", async () => {
    conMovimiento();
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    // Sin etiqueta de unidad (Carlos, 2026-09-02, revisado): «+12» a secas.
    expect(await screen.findByText(/\+12$/)).toBeInTheDocument();
    expect(await screen.findByTestId("balance-after")).toHaveTextContent(/^262$/);
  });

  it("el MISMO valor en kilos conserva la precisión de su unidad", async () => {
    conMovimiento();
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="kg" />);

    expect(await screen.findByTestId("balance-after")).toHaveTextContent(/^262\.000$/);
  });

  /**
   * La válvula de seguridad. Media pieza es un dato imposible —una importación
   * torcida, una migración a medias— y redondearlo a 263 lo ESCONDERÍA. En un
   * libro de inventario, un formato que tapa una inconsistencia es peor que
   * uno feo: el número raro tiene que verse raro.
   */
  it("media pieza se MUESTRA en vez de redondearse", async () => {
    mocked.getKardex.mockResolvedValue({
      rows: [movimiento({ quantity: "12.0000", balanceAfter: "262.5000" })],
      total: 1,
      page: 1,
      pageSize: 50,
      isComposite: false,
    });
    mocked.getStock.mockResolvedValue(resumen());
    mocked.downloadKardex.mockResolvedValue(undefined);
    mocked.getInTransit.mockResolvedValue({ rows: [] });
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    expect(await screen.findByTestId("balance-after")).toHaveTextContent(/^262\.5$/);
  });
});

/**
 * Carlos (2026-09-02, revisado): la columna Cantidad va SIN etiqueta de
 * unidad, y la segunda parte —lo que se tecleó en la presentación— solo
 * cuando la presentación no es de factor 1: «50 Pieza» al lado de «+50» es
 * decir lo mismo dos veces; «3 Caja ×12» al lado de «+36» sí cuenta algo.
 */
describe("la cantidad y su presentación", () => {
  it("con una presentación de factor 1, solo el número", async () => {
    mocked.getInTransit.mockResolvedValue({ rows: [] });
    mocked.getKardex.mockResolvedValue({
      rows: [
        movimiento({
          id: "m1",
          quantity: "50",
          presentation: {
            id: "pr1",
            name: "Pieza",
            factor: "1.0000",
            quantityInPresentation: "50",
          },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      isComposite: false,
    });
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    const celda = (await screen.findByText(/^\+50$/)).closest("td");
    expect(celda).toHaveTextContent(/^\+50$/);
    expect(screen.queryByText(/50 Pieza/)).not.toBeInTheDocument();
  });

  it("con una presentación de otro factor, el número y lo que se tecleó", async () => {
    mocked.getInTransit.mockResolvedValue({ rows: [] });
    mocked.getKardex.mockResolvedValue({
      rows: [
        movimiento({
          id: "m1",
          quantity: "36",
          presentation: {
            id: "pr2",
            name: "Caja ×12",
            factor: "12.0000",
            quantityInPresentation: "3",
          },
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      isComposite: false,
    });
    renderTab(<KardexTab productId="p1" tracksLots={false} isComposite={false} baseUnit="unit" />);

    expect(await screen.findByText(/^\+36$/)).toBeInTheDocument();
    expect(screen.getByText("3 Caja ×12")).toBeInTheDocument();
  });
});
