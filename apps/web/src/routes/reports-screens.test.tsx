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

async function renderRuta(path: string, permissions: string[] = ["reports:read"]) {
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

  describe("stock por almacén (F5-STK-04)", () => {
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

    it("filtrar por almacén viaja al API", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText(/almacén/i), "w2");

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
     * ⚠ Exportar baja lo MISMO que se está viendo. Si el export ignorara los
     * filtros, el archivo traería el inventario entero mientras la pantalla
     * muestra tres filas, y nadie lo notaría hasta abrirlo.
     */
    it("exportar usa los filtros vigentes", async () => {
      await renderRuta("/reports/stock");
      await screen.findByText("Café");
      const user = userEvent.setup();

      await user.selectOptions(screen.getByLabelText(/almacén/i), "w2");
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
   * F5-SHIFT-04 — los cierres de turno: lo que cada cajero registró al cerrar
   * («Efectivo contado en caja» y la nota) junto a lo que el sistema calculó.
   * La diferencia se pinta en color y «Ver» despliega las ventas del turno.
   */
  describe("cierres de turno (F5-SHIFT-04)", () => {
    it("lista cada turno con su almacén, quién cerró, lo contado, la diferencia y la nota", async () => {
      await renderRuta("/reports/shifts");

      expect(await screen.findByText("Faltaron diez pesos")).toBeInTheDocument();
      expect(screen.getByText("Luis Cajero")).toBeInTheDocument();
      // «Central» también es opción del selector de almacén: se mira la celda.
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
   * El hub deja de descargar y pasa a enlazar: las pantallas ya existen.
   * Es la otra mitad del cambio — si las tarjetas siguieran descargando,
   * estas pantallas serían inalcanzables desde Reportes.
   */
  describe("el hub ahora enlaza a las pantallas", () => {
    it("stock y ventas son enlaces", async () => {
      await renderRuta("/reports");

      expect(await screen.findByRole("link", { name: /stock por almacén/i })).toHaveAttribute(
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
