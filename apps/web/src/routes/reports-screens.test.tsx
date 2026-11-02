import { localCalendarDate } from "@sellpoint/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { buildWarehouse } from "@/test/warehouse-fixture";
import { createI18n } from "../i18n";
import { createQueryClient } from "../lib/query-client";
import * as rbacApi from "../lib/rbac/api";
import * as reportsApi from "../lib/reports/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

vi.mock("../lib/reports/api");
vi.mock("../lib/warehouses/api");
vi.mock("../lib/rbac/api");

const mocked = vi.mocked(reportsApi);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({
    email: "gerente@demo.test",
    permissions,
    tenant: buildTenantBlock({ id: "t1", name: "Demo" }),
  });

async function renderRuta(
  path: string,
  permissions: string[] = ["reports:read"],
  // F10-MANFIX-02: para simular a la dueña con una sucursal ASIGNADA sin
  // tener que rearmar todo `renderRuta` en cada test.
  userOverrides: Partial<AuthUser> = {},
) {
  useAuthStore.getState().setAuth("jwt", { ...demoUser(permissions), ...userOverrides });
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

const filaStock = (
  overrides: Partial<reportsApi.StockReportRow> = {},
): reportsApi.StockReportRow => ({
  productId: "p1",
  sku: "SKU-1",
  name: "Café",
  baseUnit: "unit",
  warehouseId: "w1",
  warehouseName: "Central",
  quantity: "40",
  stockMin: "100",
  totalQuantity: "60",
  belowMin: true,
  avgCost: "8.00",
  totalValue: "320.00",
  ...overrides,
});

const filaVenta = (
  overrides: Partial<reportsApi.SalesReportRow> = {},
): reportsApi.SalesReportRow => ({
  id: "s1",
  folio: "VTA-000001",
  barcode: "202608240001",
  createdAt: "2026-08-24T16:00:00.000Z",
  status: "completed",
  paymentMethod: "cash",
  total: "100.00",
  taxTotal: "0.00",
  warehouseId: "w1",
  warehouse: { id: "w1", name: "Central" },
  seller: { id: "u1", name: "Ana Pérez" },
  ...overrides,
});

const filaLinea = (overrides: Partial<reportsApi.SalesLineRow> = {}): reportsApi.SalesLineRow => ({
  id: "si1",
  saleId: "s1",
  folio: "VTA-000001",
  createdAt: "2026-08-24T16:00:00.000Z",
  status: "completed",
  warehouseId: "w1",
  warehouse: { id: "w1", name: "Central" },
  seller: { id: "u1", name: "Ana Pérez" },
  code: "AGUA-001",
  barcode: "7501234567890",
  name: "Agua mineral",
  quantity: "1",
  baseUnit: "unit",
  presentation: { name: "Caja ×12", factor: "12", allowFractionalInput: false },
  unitPrice: "130.00",
  taxAmount: "17.93",
  lineTotal: "130.00",
  ...overrides,
});

/** El día del negocio de la dueña de prueba (`buildTenantBlock`: Ciudad de México). */
const hoyDelNegocio = () => localCalendarDate("America/Mexico_City", new Date());

const turno = (overrides: Partial<reportsApi.ShiftRow> = {}): reportsApi.ShiftRow => ({
  id: "cs1",
  status: "closed",
  warehouse: { id: "w1", name: "Central" },
  openedBy: { id: "u2", name: "Luis Cajero" },
  openedAt: "2026-09-06T14:00:00.000Z",
  closedBy: { id: "u2", name: "Luis Cajero" },
  closedAt: "2026-09-06T22:00:00.000Z",
  salesCount: 2,
  totals: [
    { method: "cash", total: "100.00", count: 1 },
    { method: "card", total: "50.00", count: 1 },
    { method: "transfer", total: "0.00", count: 0 },
  ],
  openingCash: "0",
  cashExpenses: { total: "0", count: 0 },
  calculatedCash: "100.00",
  declaredCash: "90.00",
  cashDifference: "-10.00",
  closingNote: "Faltaron diez pesos",
  ...overrides,
});

/**
 * F5-STK-04 y F5-SALES-03 — las dos pantallas de reporte.
 *
 * Las dos se montan sobre el MISMO componente común (F5-HUB-03), así que lo
 * que se prueba acá no es la tabla —eso ya tiene sus tests— sino el cableado:
 * que los filtros lleguen al API tal como se eligieron y que exportar baje lo
 * MISMO que la pantalla muestra.
 */
describe("Pantallas de reporte (F5-STK-04 / F5-SALES-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(warehousesApi.listWarehouses).mockResolvedValue([
      buildWarehouse(),
      buildWarehouse({ id: "w2", code: "ALM-002", name: "Norte" }),
    ]);
    mocked.getStockReport.mockResolvedValue({
      rows: [filaStock()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mocked.getSalesReport.mockResolvedValue({
      rows: [filaVenta()],
      totals: [{ paymentMethod: "cash", total: "100.00" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mocked.downloadStockReport.mockResolvedValue(undefined);
    mocked.downloadSalesReport.mockResolvedValue(undefined);
    mocked.getSalesLinesReport.mockImplementation(async (kind) => ({
      rows:
        kind === "product"
          ? [
              filaLinea(),
              filaLinea({
                id: "si2",
                saleId: "s2",
                folio: "VTA-000002",
                status: "canceled",
                code: "LIBRO-001",
                barcode: null,
                name: "Libro de cuentos",
                quantity: "3",
                presentation: { name: "Pieza", factor: "1", allowFractionalInput: false },
                unitPrice: "50.00",
                taxAmount: "0.00",
                lineTotal: "150.00",
              }),
            ]
          : [
              filaLinea({
                code: "ENVIO",
                barcode: null,
                name: "Envío a domicilio",
                quantity: "2",
                baseUnit: null,
                presentation: null,
                unitPrice: "35.00",
                taxAmount: "9.66",
                lineTotal: "70.00",
              }),
            ],
      totals:
        kind === "product" ? { tax: "17.93", total: "130.00" } : { tax: "9.66", total: "70.00" },
      total: kind === "product" ? 2 : 1,
      page: 1,
      pageSize: 20,
    }));
    mocked.downloadSalesLinesReport.mockResolvedValue(undefined);
    mocked.getShiftsReport.mockResolvedValue({ rows: [turno()], total: 1, page: 1, pageSize: 20 });
    mocked.getShiftDetail.mockResolvedValue({
      ...turno(),
      sales: [
        {
          id: "s1",
          folio: "VTA-000001",
          createdAt: "2026-09-06T15:00:00.000Z",
          seller: { id: "u2", name: "Luis Cajero" },
          paymentMethod: "cash",
          status: "completed",
          total: "100.00",
        },
      ],
    });
    mocked.downloadShiftsReport.mockResolvedValue(undefined);
    mocked.getTaxReport.mockResolvedValue({
      rows: [
        { code: "GST", name: "GST 5%", rate: "5", base: "200.00", amount: "10.00", tickets: 2 },
        { code: "PST", name: "PST 7%", rate: "7", base: "200.00", amount: "14.00", tickets: 2 },
      ],
      totals: { gross: "224.00", net: "200.00", tax: "24.00", tickets: 2 },
    });
    mocked.downloadTaxReport.mockResolvedValue(undefined);
    vi.mocked(rbacApi.listUsers).mockResolvedValue([
      {
        id: "u2",
        email: "luis@demo.test",
        firstName: "Luis",
        lastName: "Cajero",
        secondLastName: null,
        status: "active",
        locale: "es",
        defaultWarehouseId: "w1",
        roles: [],
      } as unknown as rbacApi.UserDetail,
    ]);
  });

  describe("stock por sucursal (F5-STK-04)", () => {
    it("muestra el stock con su costo y su valor", async () => {
      await renderRuta("/reports/stock");

      expect(await screen.findByText("Café")).toBeInTheDocument();
      // Los importes se pintan como MONEDA: el reporte se lee, no se parsea.
      expect(screen.getByText(/\$320\.00/)).toBeInTheDocument();
      expect(screen.getByText(/\$8\.00/)).toBeInTheDocument();
    });

    /**
     * Carlos (2026-09-01): la flecha de «Producto» no hacía nada — el API
     * siempre ordena por nombre y el toggle asc/desc no viajaba a ningún
     * lado. Un control que no controla es peor que ninguno: se quita.
     */
    it("ninguna columna ofrece ordenar: el orden lo fija el servidor", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");

      expect(screen.queryByRole("button", { name: /producto/i })).not.toBeInTheDocument();
      expect(screen.queryByText("↑")).not.toBeInTheDocument();
    });

    it("filtrar por sucursal viaja al API", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText(/sucursal/i), "w2");

      await waitFor(() =>
        expect(mocked.getStockReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ warehouseId: "w2" }),
        ),
      );
    });

    it("«solo bajo mínimo» viaja al API", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.click(screen.getByLabelText(/bajo.*mínimo/i));

      await waitFor(() =>
        expect(mocked.getStockReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ belowMin: true }),
        ),
      );
    });

    /**
     * Carlos (2026-10-30): un buscador por producto. Viaja al API, que busca
     * por nombre o SKU: el reporte pagina en el servidor y filtrar solo la
     * página visible escondería lo que está en las demás.
     */
    it("buscar un producto viaja al API, sin los espacios de los lados", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/buscar producto/i), "  café ");

      await waitFor(() =>
        expect(mocked.getStockReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "café", page: 1 }),
        ),
      );
    });

    /** El API rechaza `search` vacío (min 1): sin texto, ni se manda. */
    it("al vaciar la búsqueda deja de mandar `search`", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();
      const buscador = screen.getByLabelText(/buscar producto/i);

      await user.type(buscador, "café");
      await waitFor(() =>
        expect(mocked.getStockReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "café" }),
        ),
      );
      await user.clear(buscador);

      await waitFor(() =>
        expect(mocked.getStockReport.mock.lastCall?.[0]).not.toHaveProperty("search"),
      );
    });

    it("exportar lleva la búsqueda vigente", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.type(screen.getByLabelText(/buscar producto/i), "café");
      await waitFor(() =>
        expect(mocked.getStockReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "café" }),
        ),
      );
      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() =>
        expect(mocked.downloadStockReport).toHaveBeenCalledWith(
          expect.objectContaining({ search: "café" }),
        ),
      );
    });

    it("el detalle por lote cambia las columnas y consulta de nuevo", async () => {
      mocked.getStockReport.mockResolvedValue({
        rows: [
          {
            productId: "p2",
            sku: "SKU-2",
            name: "Con lotes",
            baseUnit: "unit",
            warehouseId: "w1",
            warehouseName: "Central",
            lotCode: "L-1",
            expiresAt: "2027-03-01",
            location: "A-1",
            quantity: "12",
          } as unknown as reportsApi.StockReportRow,
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/reports/stock");
      const user = userEvent.setup();

      await user.click(await screen.findByLabelText(/detalle por lote/i));

      await waitFor(() =>
        expect(mocked.getStockReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ detail: "lots" }),
        ),
      );
      // La ubicación es columna solo en el detalle: sin ella el reporte no
      // dice a qué estante ir.
      expect(await screen.findByRole("columnheader", { name: /ubicación/i })).toBeInTheDocument();
    });

    /**
     * Carlos (2026-10-31): lo que un producto con lote tiene SIN lote llega
     * como su propia fila, con el código vacío. Una celda de lote vacía junto
     * a una cantidad se lee como un dato perdido: dice «Sin lote».
     */
    it("en el detalle, la fila sin lote dice «Sin lote» y deja la caducidad vacía", async () => {
      const fila = (overrides: Partial<reportsApi.StockReportRow>) =>
        ({
          productId: "p2",
          sku: "SKU-2",
          name: "Con lotes",
          baseUnit: "unit",
          warehouseId: "w1",
          warehouseName: "Central",
          location: "",
          ...overrides,
        }) as unknown as reportsApi.StockReportRow;
      mocked.getStockReport.mockResolvedValue({
        rows: [
          fila({ lotCode: "L-4", expiresAt: "2027-05-01", quantity: "4", unlotted: false }),
          fila({ lotCode: "", expiresAt: null, quantity: "9", unlotted: true }),
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/reports/stock");
      const user = userEvent.setup();

      await user.click(await screen.findByLabelText(/detalle por lote/i));

      const sinLote = (await screen.findByText("Sin lote")).closest("tr") as HTMLElement;
      const celdas = within(sinLote).getAllByRole("cell");
      // Producto, Sucursal, Lote, Caducidad, Ubicación, Cantidad.
      expect(celdas.map((c) => c.textContent)).toEqual([
        "Con lotes",
        "Central",
        "Sin lote",
        "",
        "",
        "9",
      ]);
      expect(screen.getByText("L-4")).toBeInTheDocument();
    });

    /**
     * ⚠ Exportar baja lo MISMO que se está viendo. Si el export ignorara los
     * filtros, el archivo traería el inventario entero mientras la pantalla
     * muestra tres filas, y nadie lo notaría hasta abrirlo.
     */
    it("exportar usa los filtros vigentes", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText(/sucursal/i), "w2");
      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() =>
        expect(mocked.downloadStockReport).toHaveBeenCalledWith(
          expect.objectContaining({ warehouseId: "w2" }),
        ),
      );
    });

    /**
     * ⚠ El export NO pagina, y su schema es `.strict()`: mandarle `page` o
     * `pageSize` lo hace responder 400. Se descubrió en producción —los tests
     * con la API mockeada no lo veían, porque el mock acepta cualquier cosa—.
     */
    it("exportar NO manda la paginación de la pantalla", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() => expect(mocked.downloadStockReport).toHaveBeenCalled());
      const enviado = mocked.downloadStockReport.mock.calls[0]?.[0] ?? {};
      expect(enviado).not.toHaveProperty("page");
      expect(enviado).not.toHaveProperty("pageSize");
    });

    it("sin `reports:read` no se entra", async () => {
      await renderRuta("/reports/stock", ["pos:sell"]);

      await waitFor(() => expect(screen.queryByText("Café")).not.toBeInTheDocument());
    });
  });

  describe("ventas por período (F5-SALES-03)", () => {
    it("lista las ventas con su vendedor y su total", async () => {
      await renderRuta("/reports/sales");

      expect(await screen.findByText("VTA-000001")).toBeInTheDocument();
      expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    });

    it("el código de barras es columna, como en el historial", async () => {
      await renderRuta("/reports/sales");

      expect(await screen.findByText("202608240001")).toBeInTheDocument();
    });

    /**
     * Los totales del período van al PIE y son del período entero, no de la
     * página: un pie que solo sumara lo visible sería un número inútil.
     */
    it("muestra los totales por método de pago", async () => {
      await renderRuta("/reports/sales");

      const pie = await screen.findByTestId("sales-report-totals");
      expect(within(pie).getByText(/100\.00/)).toBeInTheDocument();
    });

    it("el rango de fechas viaja al API", async () => {
      await renderRuta("/reports/sales");
      await screen.findByText("VTA-000001");
      const user = userEvent.setup();

      // «Desde» abre en hoy (Carlos, 2026-11-02): se borra antes de teclear otra fecha.
      await user.clear(screen.getByLabelText(/desde/i));
      await user.type(screen.getByLabelText(/desde/i), "2026-08-01");

      await waitFor(() =>
        expect(mocked.getSalesReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ from: "2026-08-01" }),
        ),
      );
    });

    it("el estado viaja al API", async () => {
      await renderRuta("/reports/sales");
      await screen.findByText("VTA-000001");
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText(/estado/i), "canceled");

      await waitFor(() =>
        expect(mocked.getSalesReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "canceled" }),
        ),
      );
    });

    it("exportar usa los filtros vigentes, pero NO la paginación", async () => {
      await renderRuta("/reports/sales");
      await screen.findByText("VTA-000001");
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText(/estado/i), "canceled");
      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() =>
        expect(mocked.downloadSalesReport).toHaveBeenCalledWith(
          expect.objectContaining({ status: "canceled" }),
        ),
      );
      const enviado = mocked.downloadSalesReport.mock.calls[0]?.[0] ?? {};
      expect(enviado).not.toHaveProperty("page");
      expect(enviado).not.toHaveProperty("pageSize");
    });

    it("sin `reports:read` no se entra", async () => {
      await renderRuta("/reports/sales", ["pos:view"]);

      await waitFor(() => expect(screen.queryByText("VTA-000001")).not.toBeInTheDocument());
    });
  });

  /**
   * «Ventas por producto» y «Ventas por servicio»: la MISMA pantalla con un
   * `kind`. Una línea de ticket por renglón, con los filtros de Ventas.
   */
  describe.each([
    {
      kind: "product" as const,
      path: "/reports/sales-by-product",
      titulo: "Ventas por producto",
      columnas: [
        "Fecha",
        "Folio",
        "Vendió",
        "Sucursal",
        "Código interno",
        "Código de barras",
        "Producto",
        "Cantidad",
        "Precio unitario",
        "Impuesto",
        "Total",
      ],
      nombre: "Agua mineral",
      codigo: "AGUA-001",
      // La cantidad se escribe como en el ticket: la caja y lo que trae.
      cantidad: "1 Caja ×12 (12 piezas)",
    },
    {
      kind: "service" as const,
      path: "/reports/sales-by-service",
      titulo: "Ventas por servicio",
      columnas: [
        "Fecha",
        "Folio",
        "Vendió",
        "Sucursal",
        "Código",
        "Servicio",
        "Cantidad",
        "Precio unitario",
        "Impuesto",
        "Total",
      ],
      nombre: "Envío a domicilio",
      codigo: "ENVIO",
      // Un servicio no tiene unidad: el número a secas, como en el ticket.
      cantidad: "2",
    },
  ])("$titulo", ({ kind, path, titulo, columnas, nombre, codigo, cantidad }) => {
    it("pide las líneas de su tipo y las pinta con sus columnas, en orden", async () => {
      await renderRuta(path);

      expect(await screen.findByRole("heading", { name: titulo })).toBeInTheDocument();
      await screen.findByText(nombre);
      expect(mocked.getSalesLinesReport).toHaveBeenCalledWith(
        kind,
        expect.objectContaining({ page: 1, pageSize: 20 }),
      );
      expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(columnas);

      const fila = screen.getByText(nombre).closest("tr") as HTMLElement;
      expect(within(fila).getByText(codigo)).toBeInTheDocument();
      expect(within(fila).getByText(cantidad)).toBeInTheDocument();
      expect(within(fila).getByText("Ana Pérez")).toBeInTheDocument();
      expect(within(fila).getByText("Central")).toBeInTheDocument();
    });

    it("el dinero va a la derecha y con cifras de ancho fijo; el pie suma Impuesto y Total", async () => {
      await renderRuta(path);
      const fila = (await screen.findByText(nombre)).closest("tr") as HTMLElement;

      const celdas = within(fila).getAllByRole("cell");
      for (const celda of celdas.slice(-3)) {
        expect(celda).toHaveClass("text-right", "tabular-nums");
      }
      const pie = screen.getByTestId("sales-lines-report-totals");
      expect(within(pie).getByText("Impuesto")).toBeInTheDocument();
      expect(within(pie).getByText("Total")).toBeInTheDocument();
      expect(within(pie).getByText(kind === "product" ? /17\.93/ : /9\.66/)).toBeInTheDocument();
    });

    it("«Desde» abre en hoy y la primera consulta lo lleva, sin «Hasta»", async () => {
      await renderRuta(path);
      await screen.findByText(nombre);

      expect(screen.getByLabelText(/desde/i)).toHaveValue(hoyDelNegocio());
      expect(screen.getByLabelText(/hasta/i)).toHaveValue("");
      const primera = mocked.getSalesLinesReport.mock.calls[0]?.[1] ?? {};
      expect(primera).toMatchObject({ from: hoyDelNegocio() });
      expect(primera).not.toHaveProperty("to");
    });

    it("«Limpiar fechas» pide todas las fechas y no vuelve a hoy", async () => {
      await renderRuta(path);
      await screen.findByText(nombre);
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Limpiar fechas" }));

      await waitFor(() => {
        const ultima = mocked.getSalesLinesReport.mock.lastCall?.[1] ?? {};
        expect(ultima).not.toHaveProperty("from");
        expect(ultima).not.toHaveProperty("to");
      });
      expect(screen.getByLabelText(/desde/i)).toHaveValue("");
    });

    it("sucursal y estado viajan al API, y la sucursal abre en Todas", async () => {
      await renderRuta(path);
      await screen.findByText(nombre);
      const user = userEvent.setup();
      expect(mocked.getSalesLinesReport.mock.calls[0]?.[1]).not.toHaveProperty("warehouseId");

      await user.selectOptions(screen.getByLabelText(/estado/i), "canceled");
      await user.selectOptions(screen.getByLabelText(/sucursal/i), "w2");

      await waitFor(() =>
        expect(mocked.getSalesLinesReport).toHaveBeenLastCalledWith(
          kind,
          expect.objectContaining({ status: "canceled", warehouseId: "w2", page: 1 }),
        ),
      );
    });

    it("exportar baja su Excel con los filtros vigentes, pero NO la paginación", async () => {
      await renderRuta(path);
      await screen.findByText(nombre);
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText(/estado/i), "completed");
      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() =>
        expect(mocked.downloadSalesLinesReport).toHaveBeenCalledWith(
          kind,
          expect.objectContaining({ status: "completed", from: hoyDelNegocio() }),
        ),
      );
      const enviado = mocked.downloadSalesLinesReport.mock.calls[0]?.[1] ?? {};
      expect(enviado).not.toHaveProperty("page");
      expect(enviado).not.toHaveProperty("pageSize");
    });

    it("sin `reports:read` no se entra", async () => {
      await renderRuta(path, ["pos:view"]);

      await waitFor(() => expect(screen.queryByText(nombre)).not.toBeInTheDocument());
      expect(mocked.getSalesLinesReport).not.toHaveBeenCalled();
    });
  });

  describe("ventas por producto: los detalles de la línea", () => {
    it("una línea sin código de barras deja la celda vacía y la anulada lleva su marca", async () => {
      await renderRuta("/reports/sales-by-product");
      const libro = (await screen.findByText("Libro de cuentos")).closest("tr") as HTMLElement;

      const celdas = within(libro).getAllByRole("cell");
      // Quinta y sexta columnas: Código interno y Código de barras.
      expect(celdas[4]).toHaveTextContent("LIBRO-001");
      expect(celdas[5]).toHaveTextContent(/^$/);
      expect(within(libro).getByText("Cancelada")).toBeInTheDocument();
      const agua = screen.getByText("Agua mineral").closest("tr") as HTMLElement;
      expect(within(agua).queryByText("Cancelada")).not.toBeInTheDocument();
      expect(within(agua).getByText("7501234567890")).toBeInTheDocument();
    });
  });

  /**
   * Carlos (2026-11-02): Ventas abre con lo de HOY, y «Limpiar fechas» sigue
   * mostrando todas las fechas.
   */
  describe("ventas por período abre en hoy", () => {
    it("«Desde» abre en hoy y la primera consulta lo lleva, sin «Hasta»", async () => {
      await renderRuta("/reports/sales");
      await screen.findByText("VTA-000001");

      expect(screen.getByLabelText(/desde/i)).toHaveValue(hoyDelNegocio());
      expect(screen.getByLabelText(/hasta/i)).toHaveValue("");
      const primera = mocked.getSalesReport.mock.calls[0]?.[0] ?? {};
      expect(primera).toMatchObject({ from: hoyDelNegocio() });
      expect(primera).not.toHaveProperty("to");
    });

    it("«Limpiar fechas» pide todas las fechas y no vuelve a hoy", async () => {
      await renderRuta("/reports/sales");
      await screen.findByText("VTA-000001");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Limpiar fechas" }));

      await waitFor(() => {
        const ultima = mocked.getSalesReport.mock.lastCall?.[0] ?? {};
        expect(ultima).not.toHaveProperty("from");
        expect(ultima).not.toHaveProperty("to");
      });
      expect(screen.getByLabelText(/desde/i)).toHaveValue("");
    });
  });

  /**
   * F5-SHIFT-04 — los cierres de turno: lo que cada cajero registró al cerrar
   * («Efectivo contado en caja» y la nota) junto a lo que el sistema calculó.
   * La diferencia se pinta en color y «Ver» despliega las ventas del turno.
   */
  describe("cierres de turno (F5-SHIFT-04)", () => {
    it("lista cada turno con su sucursal, quién cerró, lo contado, la diferencia y la nota", async () => {
      await renderRuta("/reports/shifts");

      expect(await screen.findByText("Faltaron diez pesos")).toBeInTheDocument();
      expect(screen.getByText("Luis Cajero")).toBeInTheDocument();
      // «Central» también es opción del selector de sucursal: se mira la celda.
      expect(screen.getByRole("cell", { name: "Central" })).toBeInTheDocument();
      expect(screen.getByText(/\$90\.00/)).toBeInTheDocument();
    });

    it("una diferencia negativa se marca como faltante; cuadrar se dice con palabras", async () => {
      mocked.getShiftsReport.mockResolvedValue({
        rows: [
          turno(),
          turno({ id: "cs2", declaredCash: "100.00", cashDifference: "0.00", closingNote: null }),
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/reports/shifts");

      const faltante = await screen.findByText(/-\$10\.00/);
      expect(faltante).toHaveClass("text-destructive");
      expect(screen.getByText("Cuadró")).toBeInTheDocument();
    });

    /** F9-EXP-10 — los gastos que salieron del cajón, con signo, antes de lo calculado. */
    it("muestra los gastos en efectivo del turno con signo, y «—» cuando no hubo", async () => {
      mocked.getShiftsReport.mockResolvedValue({
        rows: [
          turno({
            cashExpenses: { total: "20.00", count: 1 },
            calculatedCash: "80.00",
            cashDifference: "10.00",
          }),
          turno({ id: "cs2" }),
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/reports/shifts");

      expect(
        await screen.findByRole("columnheader", { name: "Gastos en efectivo" }),
      ).toBeInTheDocument();
      expect(screen.getByText("−$20.00")).toBeInTheDocument();
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    });

    /**
     * F10-MANFIX-10 — el fondo con que abrió cada turno, antes de los gastos
     * y de lo calculado, que ya lo suma. Sin fondo, «—», como los gastos.
     */
    it("muestra el fondo inicial de cada turno antes de los gastos, y «—» sin fondo", async () => {
      mocked.getShiftsReport.mockResolvedValue({
        rows: [
          turno({ openingCash: "500.00", calculatedCash: "600.00", cashDifference: "-510.00" }),
          turno({ id: "cs2" }),
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/reports/shifts");

      const encabezado = await screen.findByRole("columnheader", { name: "Fondo inicial" });
      const encabezados = screen.getAllByRole("columnheader").map((th) => th.textContent);
      expect(encabezados.indexOf("Fondo inicial")).toBe(
        encabezados.indexOf("Gastos en efectivo") - 1,
      );
      expect(encabezado).toBeInTheDocument();
      const filas = screen.getAllByRole("row").slice(1);
      const columna = encabezados.indexOf("Fondo inicial");
      expect(within(filas[0] as HTMLElement).getAllByRole("cell")[columna]).toHaveTextContent(
        "$500.00",
      );
      expect(within(filas[1] as HTMLElement).getAllByRole("cell")[columna]).toHaveTextContent("—");
    });

    it("abre con el día actual del negocio y solo los cerrados", async () => {
      await renderRuta("/reports/shifts");
      await screen.findByText("Faltaron diez pesos");

      expect(mocked.getShiftsReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "closed",
          from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });

    it("el empleado y el estado viajan al API", async () => {
      await renderRuta("/reports/shifts", ["reports:read", "users:read"]);
      await screen.findByText("Faltaron diez pesos");
      const user = userEvent.setup();

      await user.selectOptions(await screen.findByLabelText(/empleado/i), "u2");
      await waitFor(() =>
        expect(mocked.getShiftsReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ userId: "u2" }),
        ),
      );

      await user.selectOptions(screen.getByLabelText(/turnos/i), "open");
      await waitFor(() =>
        expect(mocked.getShiftsReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ status: "open" }),
        ),
      );
    });

    it("sin `users:read` no se ofrece filtrar por empleado ni se pide la lista", async () => {
      await renderRuta("/reports/shifts");
      await screen.findByText("Faltaron diez pesos");

      expect(screen.queryByLabelText(/empleado/i)).not.toBeInTheDocument();
      expect(rbacApi.listUsers).not.toHaveBeenCalled();
    });

    it("«Ver» despliega las ventas del turno debajo", async () => {
      await renderRuta("/reports/shifts");
      await screen.findByText("Faltaron diez pesos");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /ver turno/i }));

      const detalle = await screen.findByTestId("shift-detail");
      expect(await within(detalle).findByText("VTA-000001")).toBeInTheDocument();
      expect(mocked.getShiftDetail).toHaveBeenCalledWith("cs1");
    });

    it("exportar usa los filtros vigentes, pero NO la paginación", async () => {
      await renderRuta("/reports/shifts");
      await screen.findByText("Faltaron diez pesos");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() =>
        expect(mocked.downloadShiftsReport).toHaveBeenCalledWith(
          expect.objectContaining({ status: "closed" }),
        ),
      );
      const enviado = mocked.downloadShiftsReport.mock.calls[0]?.[0] ?? {};
      expect(enviado).not.toHaveProperty("page");
      expect(enviado).not.toHaveProperty("pageSize");
    });

    it("sin `reports:read` no se entra", async () => {
      await renderRuta("/reports/shifts", ["pos:view"]);

      await waitFor(() =>
        expect(screen.queryByText("Faltaron diez pesos")).not.toBeInTheDocument(),
      );
    });
  });

  /**
   * F4-TAX-21 — los impuestos cobrados: un renglón por componente y tasa, con
   * el pie que el contador necesita (bruto, neto, impuesto). Abre con el mes
   * en curso del negocio: es lo que se declara.
   */
  describe("impuestos cobrados (F4-TAX-21)", () => {
    it("lista un renglón por componente y tasa, y el pie con bruto, neto e impuesto", async () => {
      await renderRuta("/reports/taxes");

      expect(await screen.findByRole("cell", { name: "GST 5%" })).toBeInTheDocument();
      expect(screen.getByRole("cell", { name: "PST 7%" })).toBeInTheDocument();
      expect(screen.getByRole("cell", { name: "$10.00" })).toBeInTheDocument();
      expect(screen.getAllByRole("cell", { name: "$200.00" })).toHaveLength(2);
      const pie = screen.getByTestId("tax-report-totals");
      expect(pie).toHaveTextContent("$224.00");
      expect(pie).toHaveTextContent("$200.00");
      expect(pie).toHaveTextContent("$24.00");
    });

    it("abre con el mes en curso del negocio y exporta con los filtros puestos", async () => {
      const user = userEvent.setup();
      await renderRuta("/reports/taxes");
      await screen.findByRole("cell", { name: "GST 5%" });

      expect(mocked.getTaxReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          from: expect.stringMatching(/^\d{4}-\d{2}-01$/),
          to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );

      await user.click(screen.getByRole("button", { name: "Exportar Excel" }));
      await waitFor(() =>
        expect(mocked.downloadTaxReport).toHaveBeenCalledWith(
          expect.objectContaining({ from: expect.stringMatching(/^\d{4}-\d{2}-01$/) }),
        ),
      );
    });

    it("sin `reports:read` no se entra", async () => {
      await renderRuta("/reports/taxes", ["pos:view"]);

      await waitFor(() => expect(screen.queryByTestId("tax-report")).not.toBeInTheDocument());
    });
  });

  /**
   * F10-MANFIX-02 (decidido por Carlos el 2026-09-24) — el bug real: el
   * `WarehouseSelect` se auto-elegía la sucursal ASIGNADA del usuario
   * (F3-HOME-04) y el reporte mandaba ese `warehouseId`, así que una dueña
   * con Centro asignada nunca veía el negocio completo. El API sin
   * `warehouseId` ya junta el alcance (`scope.warehouseIds`), así que
   * alcanza con que el WEB deje de mandarlo por default.
   */
  describe("F10-MANFIX-02 — los cuatro reportes abren en Todas las sucursales", () => {
    const casos = [
      {
        path: "/reports/stock",
        mockFn: mocked.getStockReport,
        esperar: () => screen.findByText("Café"),
      },
      {
        path: "/reports/sales",
        mockFn: mocked.getSalesReport,
        esperar: () => screen.findByText("VTA-000001"),
      },
      {
        path: "/reports/shifts",
        mockFn: mocked.getShiftsReport,
        esperar: () => screen.findByText("Faltaron diez pesos"),
      },
      {
        path: "/reports/taxes",
        mockFn: mocked.getTaxReport,
        esperar: () => screen.findByRole("cell", { name: "GST 5%" }),
      },
    ] as const;

    it.each(casos)("$path abre sin mandar warehouseId (dueña, alcance completo)", async (caso) => {
      await renderRuta(caso.path);
      await caso.esperar();

      const enviado = caso.mockFn.mock.calls[0]?.[0] ?? {};
      expect(enviado).not.toHaveProperty("warehouseId");
      expect(screen.getByLabelText(/sucursal/i)).toHaveValue("");
    });

    it.each(casos)(
      "$path: un usuario limitado a UNA sucursal asignada tampoco la auto-selecciona",
      async (caso) => {
        // Alcance de una sola sucursal —lo que trae `scoped: true`— Y esa
        // misma sucursal como asignada (F3-HOME-04): el caso exacto del bug.
        vi.mocked(warehousesApi.listWarehouses).mockImplementation(async (options = {}) =>
          options.scoped
            ? [buildWarehouse()]
            : [buildWarehouse(), buildWarehouse({ id: "w2", code: "ALM-002", name: "Norte" })],
        );

        await renderRuta(caso.path, ["reports:read"], { defaultWarehouseId: "w1" });
        await caso.esperar();

        const enviado = caso.mockFn.mock.calls[0]?.[0] ?? {};
        expect(enviado).not.toHaveProperty("warehouseId");
        expect(screen.getByLabelText(/sucursal/i)).toHaveValue("");
      },
    );
  });

  /**
   * El hub deja de descargar y pasa a enlazar: las pantallas ya existen.
   * Es la otra mitad del cambio — si las tarjetas siguieran descargando,
   * estas pantallas serían inalcanzables desde Reportes.
   */
  describe("el hub ahora enlaza a las pantallas", () => {
    it("stock y ventas son enlaces", async () => {
      await renderRuta("/reports");

      expect(await screen.findByRole("link", { name: /stock por sucursal/i })).toHaveAttribute(
        "href",
        "/reports/stock",
      );
      expect(screen.getByRole("link", { name: /^ventas$/i })).toHaveAttribute(
        "href",
        "/reports/sales",
      );
    });
  });
});
