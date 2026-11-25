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
import * as reportsApi from "../lib/reports/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

vi.mock("../lib/reports/api");
vi.mock("../lib/warehouses/api");

const mocked = vi.mocked(reportsApi);

const QUESO = "3f2b9c1e-8d4a-4b6f-9a1c-2e7d5f0a1b3c";
const CORTE = "6a0e7d2c-1b3f-4c5d-8e9f-0a1b2c3d4e5f";
const NORTE = "9b8c7d6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e";

const fila = (overrides: Partial<reportsApi.ItemsReportRow> = {}): reportsApi.ItemsReportRow => ({
  kind: "product",
  itemId: QUESO,
  code: "QUESO-001",
  name: "Queso Oaxaca",
  quantity: "2.5000",
  baseUnit: "kg",
  revenue: "510.00",
  cost: "375.00",
  profit: "135.00",
  margin: 26.5,
  ...overrides,
});

const FILAS: reportsApi.ItemsReportRow[] = [
  fila(),
  fila({
    kind: "service",
    itemId: CORTE,
    code: "CORTE-001",
    name: "Corte de cabello",
    quantity: "3.0000",
    baseUnit: null,
    revenue: "300.00",
    cost: "90.00",
    profit: "210.00",
    margin: 70,
  }),
  fila({
    kind: "concept",
    itemId: "concept:Instalación",
    code: null,
    name: "Instalación",
    quantity: "1.0000",
    baseUnit: null,
    revenue: "50.00",
    cost: null,
    profit: null,
    margin: null,
  }),
];

const PERDIDAS: reportsApi.ItemsReportRow[] = [
  fila({
    kind: "service",
    itemId: CORTE,
    name: "Planchado",
    quantity: "2.0000",
    baseUnit: null,
    revenue: "40.00",
    cost: "52.00",
    profit: "-12.00",
    margin: -30,
  }),
];

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({
    email: "gerente@demo.test",
    permissions,
    tenant: buildTenantBlock({ id: "t1", name: "Demo" }),
  });

async function renderRuta(path: string, language: "es" | "en" = "es") {
  useAuthStore.getState().setAuth("jwt", { ...demoUser(["reports:read"]), locale: language });
  const i18n = createI18n();
  await i18n.changeLanguage(language);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

/** El mes en curso del negocio de prueba (`buildTenantBlock`: Ciudad de México). */
function mesEnCurso() {
  const hoy = localCalendarDate("America/Mexico_City", new Date());
  return { from: `${hoy.slice(0, 7)}-01`, to: hoy };
}

/** Lo que pide el `href` de un enlace, sin depender del orden de los parámetros. */
function destino(enlace: HTMLElement) {
  const url = new URL(enlace.getAttribute("href") ?? "", "http://x");
  return { pathname: url.pathname, search: Object.fromEntries(url.searchParams) };
}

/**
 * F10-RPT-04 — «Más vendidos», «Mayor utilidad» y «Vendidos bajo su costo»
 * (Carlos, 2026-11-25: «con filtros como otros reportes (sucursal, fechas,
 * productos o servicios)» y «el Reporte de productos que vendieron debajo de
 * su costo»). Una sola pantalla con tres vistas sobre `GET reports/items`.
 */
describe("Reportes por artículo (F10-RPT-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(warehousesApi.listWarehouses).mockResolvedValue([
      buildWarehouse(),
      buildWarehouse({ id: NORTE, code: "ALM-002", name: "Norte" }),
    ]);
    mocked.getItemsReport.mockImplementation(async (query) => ({
      rows: query.view === "below-cost" ? PERDIDAS : FILAS,
      totals:
        query.view === "below-cost"
          ? { revenue: "40.00", cost: "52.00", profit: "-12.00", margin: -30 }
          : { revenue: "860.00", cost: null, profit: null, margin: null },
      total: query.view === "below-cost" ? 1 : 3,
      page: 1,
      pageSize: 20,
    }));
    mocked.downloadItemsReport.mockResolvedValue(undefined);
  });

  describe("las tres vistas", () => {
    it.each([
      { path: "/reports/top-sold", view: "top-sold", titulo: "Más vendidos" },
      { path: "/reports/top-profit", view: "top-profit", titulo: "Mayor utilidad" },
      { path: "/reports/below-cost", view: "below-cost", titulo: "Vendidos bajo su costo" },
    ] as const)(
      "$titulo pide su vista, abre en el mes en curso y regresa a Reportes",
      async ({ path, view, titulo }) => {
        await renderRuta(path);

        const encabezado = (await screen.findByRole("heading", { level: 1, name: titulo })).closest(
          "header",
        ) as HTMLElement;
        expect(within(encabezado).getByRole("link", { name: "Volver a Reportes" })).toHaveAttribute(
          "href",
          "/reports",
        );
        await waitFor(() =>
          expect(mocked.getItemsReport).toHaveBeenCalledWith({
            view,
            type: "all",
            ...mesEnCurso(),
            page: 1,
            pageSize: 20,
          }),
        );
        // Abre en Todas las sucursales y con el mes en curso, como el panel.
        expect(screen.getByLabelText(/desde/i)).toHaveValue(mesEnCurso().from);
        expect(screen.getByLabelText(/hasta/i)).toHaveValue(mesEnCurso().to);
        expect(screen.getByLabelText("Tipo")).toHaveValue("all");
      },
    );

    it("cada artículo dice su tipo, su cantidad con su unidad y su venta, costo, utilidad y margen", async () => {
      await renderRuta("/reports/top-sold");
      const reporte = await screen.findByTestId("top-sold-report");
      await within(reporte).findByText("Queso Oaxaca");

      expect(
        within(reporte)
          .getAllByRole("columnheader")
          .map((c) => c.textContent),
      ).toEqual(["Artículo", "Cantidad", "Venta sin impuesto", "Costo", "Utilidad", "Margen"]);

      const queso = within(reporte).getByText("Queso Oaxaca").closest("tr") as HTMLElement;
      expect(within(queso).getByRole("img", { name: "Producto" })).toBeInTheDocument();
      expect(
        within(queso)
          .getAllByRole("cell")
          .map((c) => c.textContent),
      ).toEqual(["Queso Oaxaca", "2.500 kilogramos", "$510.00", "$375.00", "$135.00", "26.5%"]);

      const corte = within(reporte).getByText("Corte de cabello").closest("tr") as HTMLElement;
      expect(within(corte).getByRole("img", { name: "Servicio" })).toBeInTheDocument();
      // Un servicio no tiene unidad: se cuenta.
      expect(within(corte).getAllByRole("cell")[1]).toHaveTextContent(/^3$/);

      // Sin costo no hay utilidad: las celdas quedan vacías, ni cero ni inventada.
      const instalacion = within(reporte).getByText("Instalación").closest("tr") as HTMLElement;
      expect(within(instalacion).getByRole("img", { name: "Concepto" })).toBeInTheDocument();
      expect(
        within(instalacion)
          .getAllByRole("cell")
          .slice(3)
          .map((c) => c.textContent),
      ).toEqual(["", "", ""]);
    });

    it("el pie trae los totales de todo lo filtrado", async () => {
      await renderRuta("/reports/below-cost");

      const pie = await screen.findByTestId("items-report-totals");
      expect(pie).toHaveAccessibleName("Totales del período");
      expect(within(pie).getByText("Venta sin impuesto").nextElementSibling).toHaveTextContent(
        "$40.00",
      );
      expect(within(pie).getByText("Costo").nextElementSibling).toHaveTextContent("$52.00");
      expect(within(pie).getByText("Utilidad").nextElementSibling).toHaveTextContent("-$12.00");
      expect(within(pie).getByText("Margen").nextElementSibling).toHaveTextContent("-30%");
    });

    it("en inglés, los títulos, los filtros y las columnas van en inglés", async () => {
      await renderRuta("/reports/top-profit", "en");

      expect(
        await screen.findByRole("heading", { level: 1, name: "Top profit" }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Type")).toBeInTheDocument();
      expect(await screen.findByRole("columnheader", { name: "Sales before tax" })).toBeVisible();
      expect(screen.getByText("2.500 kilograms")).toBeInTheDocument();
    });
  });

  describe("«Vendidos bajo su costo»", () => {
    it("avisa arriba que los artículos sin costo no aparecen y pinta la pérdida en rojo", async () => {
      await renderRuta("/reports/below-cost");
      const reporte = await screen.findByTestId("below-cost-report");

      expect(within(reporte).getByRole("note")).toHaveTextContent(
        "Solo aparecen los artículos con costo capturado: sin su costo no se puede saber si se vendieron por debajo de él.",
      );
      const planchado = (await within(reporte).findByText("Planchado")).closest(
        "tr",
      ) as HTMLElement;
      const perdida = within(planchado).getByText("-$12.00");
      expect(perdida).toHaveClass("text-destructive");
    });

    it("«Más vendidos» y «Mayor utilidad» no llevan ese aviso", async () => {
      await renderRuta("/reports/top-sold");
      await screen.findByTestId("top-sold-report");

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });
  });

  describe("los filtros", () => {
    it("el filtro de tipo vuelve a pedir a la página 1 con Productos o con Servicios", async () => {
      await renderRuta("/reports/top-sold");
      await screen.findByText("Queso Oaxaca");
      const user = userEvent.setup();

      expect(
        within(screen.getByLabelText("Tipo"))
          .getAllByRole("option")
          .map((o) => o.textContent),
      ).toEqual(["Todos", "Productos", "Servicios"]);

      await user.selectOptions(screen.getByLabelText("Tipo"), "Servicios");
      await waitFor(() =>
        expect(mocked.getItemsReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ view: "top-sold", type: "service", page: 1 }),
        ),
      );

      await user.selectOptions(screen.getByLabelText("Tipo"), "Productos");
      await waitFor(() =>
        expect(mocked.getItemsReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ type: "product", page: 1 }),
        ),
      );
    });

    it("la sucursal filtra el reporte", async () => {
      await renderRuta("/reports/top-profit");
      await screen.findByText("Queso Oaxaca");
      const user = userEvent.setup();

      await user.selectOptions(await screen.findByLabelText("Sucursal"), "Norte");

      await waitFor(() =>
        expect(mocked.getItemsReport).toHaveBeenLastCalledWith(
          expect.objectContaining({ view: "top-profit", warehouseId: NORTE, page: 1 }),
        ),
      );
    });

    it("abre con el tipo, la sucursal y las fechas de la URL", async () => {
      await renderRuta(
        `/reports/top-sold?type=service&warehouseId=${NORTE}&from=2026-11-01&to=2026-11-15`,
      );
      await screen.findByText("Queso Oaxaca");

      expect(mocked.getItemsReport.mock.calls[0]?.[0]).toEqual({
        view: "top-sold",
        type: "service",
        warehouseId: NORTE,
        from: "2026-11-01",
        to: "2026-11-15",
        page: 1,
        pageSize: 20,
      });
      expect(screen.getByLabelText("Tipo")).toHaveValue("service");
    });

    it("lo inválido de la URL se descarta y la pantalla abre como siempre", async () => {
      await renderRuta("/reports/top-sold?type=todo&warehouseId=norte&from=ayer&to=2026-13-40");
      await screen.findByText("Queso Oaxaca");

      expect(mocked.getItemsReport.mock.calls[0]?.[0]).toEqual({
        view: "top-sold",
        type: "all",
        ...mesEnCurso(),
        page: 1,
        pageSize: 20,
      });
    });

    it("exportar baja la misma vista con los mismos filtros, sin paginar", async () => {
      await renderRuta("/reports/below-cost?type=service");
      await screen.findByText("Planchado");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: "Exportar Excel" }));

      await waitFor(() =>
        expect(mocked.downloadItemsReport).toHaveBeenCalledWith({
          view: "below-cost",
          type: "service",
          ...mesEnCurso(),
        }),
      );
    });
  });

  /**
   * Decisión 2 de F10-RPT: cada artículo lleva a sus tickets en «Ventas por
   * producto» o «Ventas por servicio», filtrados por él y por las mismas
   * fechas y sucursal (el contrato de F10-RPT-02).
   */
  describe("el enlace a las ventas del artículo", () => {
    it("un producto lleva a Ventas por producto y un servicio a Ventas por servicio", async () => {
      await renderRuta(`/reports/top-sold?warehouseId=${NORTE}&from=2026-11-01&to=2026-11-15`);
      await screen.findByText("Queso Oaxaca");

      expect(destino(screen.getByRole("link", { name: "Queso Oaxaca" }))).toEqual({
        pathname: "/reports/sales-by-product",
        search: { itemId: QUESO, warehouseId: NORTE, from: "2026-11-01", to: "2026-11-15" },
      });
      expect(destino(screen.getByRole("link", { name: "Corte de cabello" }))).toEqual({
        pathname: "/reports/sales-by-service",
        search: { itemId: CORTE, warehouseId: NORTE, from: "2026-11-01", to: "2026-11-15" },
      });
    });

    it("un concepto lleva a Ventas por producto sin artículo, con las mismas fechas", async () => {
      await renderRuta("/reports/top-sold?from=2026-11-01&to=2026-11-15");
      await screen.findByText("Queso Oaxaca");

      expect(destino(screen.getByRole("link", { name: "Instalación" }))).toEqual({
        pathname: "/reports/sales-by-product",
        search: { from: "2026-11-01", to: "2026-11-15" },
      });
    });

    it("al presionarlo abre las ventas del artículo ya filtradas", async () => {
      mocked.getSalesLinesReport.mockResolvedValue({
        rows: [],
        totals: null,
        total: 0,
        page: 1,
        pageSize: 20,
        item: { id: CORTE, name: "Corte de cabello" },
      });
      await renderRuta("/reports/top-sold?from=2026-11-01&to=2026-11-15");
      await screen.findByText("Queso Oaxaca");
      const user = userEvent.setup();

      await user.click(screen.getByRole("link", { name: "Corte de cabello" }));

      expect(await screen.findByTestId("sales-by-service-report")).toBeInTheDocument();
      await waitFor(() =>
        expect(mocked.getSalesLinesReport).toHaveBeenCalledWith(
          "service",
          expect.objectContaining({
            itemId: CORTE,
            from: "2026-11-01",
            to: "2026-11-15",
            page: 1,
          }),
        ),
      );
    });
  });
});
