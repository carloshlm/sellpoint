import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import { createQueryClient } from "../lib/query-client";
import * as reportsApi from "../lib/reports/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

vi.mock("../lib/reports/api");
vi.mock("../lib/warehouses/api");

const mocked = vi.mocked(reportsApi);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "gerente@demo.test",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: SUBSCRIPTION_PLUS,
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
    sellWithoutStock: false,
    usesLocations: false,
  },
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
  warehouseId: "w1",
  warehouse: { id: "w1", name: "Central" },
  seller: { id: "u1", name: "Ana Pérez" },
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
      {
        id: "w1",
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
        name: "Norte",
        address: null,
        phone: null,
        email: null,
        attributes: {},
        isActive: true,
        deactivationBlockedBy: null,
      },
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
  });

  describe("stock por almacén (F5-STK-04)", () => {
    it("muestra el stock con su costo y su valor", async () => {
      await renderRuta("/reports/stock");

      expect(await screen.findByText("Café")).toBeInTheDocument();
      // Los importes se pintan como MONEDA: el reporte se lee, no se parsea.
      expect(screen.getByText(/\$320\.00/)).toBeInTheDocument();
      expect(screen.getByText(/\$8\.00/)).toBeInTheDocument();
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
