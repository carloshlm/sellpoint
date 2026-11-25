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
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReportsHub } from "@/components/reports/reports-hub";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { createI18n } from "../i18n";
import { createQueryClient } from "../lib/query-client";
import * as reportsApi from "../lib/reports/api";
import { routeTree } from "../routeTree.gen";

vi.mock("../lib/reports/api", () => ({
  downloadUsersReport: vi.fn(),
  downloadWarehousesReport: vi.fn(),
  downloadCatalogReport: vi.fn(),
}));

/** Las rutas que el router conoce hoy. Ver la barrera de enlaces muertos. */
const RUTAS_EXISTENTES = [
  "/catalog/products",
  "/movements/expiring",
  "/movements/transfers",
  "/reports",
  "/reports/below-cost",
  "/reports/sales",
  "/reports/sales-by-product",
  "/reports/sales-by-service",
  "/reports/shifts",
  "/reports/stock",
  "/reports/taxes",
  "/reports/top-profit",
  "/reports/top-sold",
];

const mocked = vi.mocked(reportsApi);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({
    email: "gerente@demo.test",
    permissions,
    tenant: buildTenantBlock({ id: "t1", name: "Demo" }),
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

/**
 * F5-HUB-02 — el hub de Reportes.
 *
 * Las tarjetas, en cinco secciones (F10-RPT-05), tienen tres comportamientos:
 *  · Las que llevan a una PANTALLA (stock, ventas) navegan.
 *  · Las que son EXPORT DIRECTO (usuarios, sucursales, catálogo) descargan sin
 *    moverse: una tabla acá duplicaría listados que ya existen.
 *  · Las HEREDADAS de F3 (kardex, vencimientos, tránsito) enlazan a su
 *    pantalla, que ya existe y ya sabe filtrar.
 */
describe("Hub de reportes (F5-HUB-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.downloadUsersReport.mockResolvedValue(undefined);
    mocked.downloadWarehousesReport.mockResolvedValue(undefined);
    mocked.downloadCatalogReport.mockResolvedValue(undefined);
  });

  it("con `reports:read` e `inventory:read` se ven las quince tarjetas", async () => {
    await renderRuta("/reports", ["reports:read", "inventory:read"]);

    const hub = await screen.findByTestId("reports-hub");
    expect(within(hub).getAllByRole("listitem")).toHaveLength(15);
  });

  /**
   * F10-RPT-05 — Carlos (2026-11-25): «se pueden agrupar los reportes de
   * ventas, otra agrupación por control de Inventario (Stock por sucursal,
   * Karedex, etc) y otras agrupaciones que me recomiendes». Cinco secciones,
   * cada una con su título y una línea de ayuda (decisión 4 de F10-RPT).
   */
  it("las tarjetas van en cinco secciones, cada una con su título y su ayuda", async () => {
    await renderRuta("/reports", ["reports:read", "inventory:read"]);

    const hub = await screen.findByTestId("reports-hub");
    const secciones = within(hub)
      .getAllByRole("region")
      .map((seccion) => ({
        titulo: within(seccion).getByRole("heading", { level: 2 }).textContent,
        tarjetas: within(seccion)
          .getAllByRole("listitem")
          .map((tarjeta) => tarjeta.querySelector("a, button")?.getAttribute("aria-label")),
      }));
    expect(secciones).toEqual([
      {
        titulo: "Ventas",
        tarjetas: ["Ventas", "Ventas por producto", "Ventas por servicio", "Más vendidos"],
      },
      { titulo: "Utilidad", tarjetas: ["Mayor utilidad", "Vendidos bajo su costo"] },
      { titulo: "Caja e impuestos", tarjetas: ["Cierres de turno", "Impuestos cobrados"] },
      {
        titulo: "Inventario",
        tarjetas: ["Stock por sucursal", "Kardex", "Vencimientos", "En tránsito"],
      },
      { titulo: "Catálogos para descargar", tarjetas: ["Catálogo", "Usuarios", "Sucursales"] },
    ]);
    // Cada sección se nombra por su título y lleva su línea de ayuda.
    expect(within(hub).getByRole("region", { name: "Utilidad" })).toHaveTextContent(
      "Cuánto te deja cada artículo y cuáles vendes por debajo de su costo.",
    );
    expect(within(hub).getByRole("region", { name: "Catálogos para descargar" })).toHaveTextContent(
      "Cada tarjeta baja un Excel en ese momento, sin abrir otra pantalla.",
    );
  });

  /** F10-RPT-04 — las tres pantallas nuevas, con su detalle. */
  it("Más vendidos, Mayor utilidad y Vendidos bajo su costo llevan a su pantalla", async () => {
    await renderRuta("/reports", ["reports:read"]);

    const hub = await screen.findByTestId("reports-hub");
    expect(within(hub).getByRole("link", { name: "Más vendidos" })).toHaveAttribute(
      "href",
      "/reports/top-sold",
    );
    expect(within(hub).getByRole("link", { name: "Mayor utilidad" })).toHaveAttribute(
      "href",
      "/reports/top-profit",
    );
    expect(within(hub).getByRole("link", { name: "Vendidos bajo su costo" })).toHaveAttribute(
      "href",
      "/reports/below-cost",
    );
    expect(
      within(hub).getByText("Lo que vendiste por menos de lo que te costó y cuánto perdiste."),
    ).toBeInTheDocument();
  });

  /**
   * «Ventas por producto» y «Ventas por servicio» van justo después de
   * «Ventas»: son la misma consulta con más resolución, una línea de ticket
   * por renglón.
   */
  it("Ventas por producto y Ventas por servicio siguen a Ventas y llevan a su pantalla", async () => {
    await renderRuta("/reports", ["reports:read"]);

    const hub = await screen.findByTestId("reports-hub");
    const titulos = within(hub)
      .getAllByRole("listitem")
      .map((tarjeta) => tarjeta.querySelector("a, button")?.getAttribute("aria-label"));
    expect(titulos.slice(0, 3)).toEqual(["Ventas", "Ventas por producto", "Ventas por servicio"]);
    expect(screen.getByRole("link", { name: "Ventas por producto" })).toHaveAttribute(
      "href",
      "/reports/sales-by-product",
    );
    expect(screen.getByRole("link", { name: "Ventas por servicio" })).toHaveAttribute(
      "href",
      "/reports/sales-by-service",
    );
    expect(
      within(hub).getByText(
        "Cada producto vendido, ticket por ticket: cantidad, precio, impuesto y total.",
      ),
    ).toBeInTheDocument();
    expect(
      within(hub).getByText(
        "Cada servicio vendido, ticket por ticket: cantidad, precio, impuesto y total.",
      ),
    ).toBeInTheDocument();
  });

  /**
   * Las tarjetas de export DIRECTO descargan sin navegar. Si abrieran una
   * pantalla intermedia, esa pantalla sería una copia del listado que la
   * persona ya tiene en Sistema o en Catálogo.
   */
  it("la tarjeta de usuarios descarga en el momento, sin navegar", async () => {
    await renderRuta("/reports", ["reports:read"]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /usuarios/i }));

    await waitFor(() => expect(mocked.downloadUsersReport).toHaveBeenCalledTimes(1));
  });

  it("la de sucursales y la de catálogo también", async () => {
    await renderRuta("/reports", ["reports:read"]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /sucursales/i }));
    await user.click(screen.getByRole("button", { name: /catálogo/i }));

    await waitFor(() => {
      expect(mocked.downloadWarehousesReport).toHaveBeenCalledTimes(1);
      expect(mocked.downloadCatalogReport).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * Con sus pantallas ya construidas, stock y ventas ENLAZAN. Desde el hub se
   * entra a filtrar; exportar con los filtros puestos es más útil que bajar
   * el universo entero de un botón.
   */
  it("stock y ventas llevan a su pantalla", async () => {
    await renderRuta("/reports", ["reports:read"]);

    expect(await screen.findByRole("link", { name: /stock por sucursal/i })).toHaveAttribute(
      "href",
      "/reports/stock",
    );
    expect(screen.getByRole("link", { name: /^ventas$/i })).toHaveAttribute(
      "href",
      "/reports/sales",
    );
  });

  /**
   * ⚠ La barrera contra el enlace muerto: ninguna tarjeta puede apuntar a una
   * ruta que el router no conoce. La lista es explícita a propósito — si
   * alguien agrega un `to` inventado, el test lo caza aunque la ruta parezca
   * razonable.
   */
  it("todos los enlaces del hub llevan a rutas que existen", async () => {
    await renderRuta("/reports", ["reports:read", "inventory:read"]);

    const hub = await screen.findByTestId("reports-hub");
    const destinos = within(hub)
      .getAllByRole("link")
      .map((enlace) => enlace.getAttribute("href"));

    expect(destinos.length).toBeGreaterThan(0);
    for (const destino of destinos) {
      expect(RUTAS_EXISTENTES).toContain(destino);
    }
  });

  /**
   * Vencimientos y tránsito son herencias de F3: su pantalla ya existe y ya
   * sabe filtrar. Construir una nueva en Reportes sería mantener dos.
   */
  it("las herencias de F3 enlazan a su pantalla existente", async () => {
    await renderRuta("/reports", ["reports:read", "inventory:read"]);

    expect(await screen.findByRole("link", { name: /vencimientos/i })).toHaveAttribute(
      "href",
      "/movements/expiring",
    );
  });

  /**
   * Vencimientos y tránsito se leen con `inventory:read`, no con
   * `reports:read`: exportar la pantalla que ya estás viendo no puede pedir un
   * permiso nuevo. Quien no tiene ese permiso no ve esas dos tarjetas.
   */
  it("sin `inventory:read` no se ven las tarjetas heredadas de inventario", async () => {
    await renderRuta("/reports", ["reports:read"]);

    const hub = await screen.findByTestId("reports-hub");
    expect(within(hub).queryByRole("link", { name: /vencimientos/i })).not.toBeInTheDocument();
    expect(within(hub).getAllByRole("listitem")).toHaveLength(13);
    // Inventario sigue: le quedan Stock por sucursal y Kardex.
    expect(
      within(within(hub).getByRole("region", { name: "Inventario" })).getAllByRole("listitem"),
    ).toHaveLength(2);
  });

  /**
   * Una sección sin tarjetas visibles por permisos no se muestra: un título
   * con nada debajo se lee como un error. Hoy la ruta del hub pide
   * `reports:read` y con él las cinco tienen algo; por eso se monta el hub
   * solo, con un permiso que deja nada más las tarjetas de inventario.
   */
  it("una sección sin tarjetas visibles por permisos no se muestra", async () => {
    useAuthStore.getState().setAuth("jwt", demoUser(["inventory:read"]));
    const router = createRouter({
      routeTree: createRootRoute({ component: ReportsHub }),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    const hub = await screen.findByTestId("reports-hub");
    expect(
      within(hub)
        .getAllByRole("region")
        .map((seccion) => within(seccion).getByRole("heading", { level: 2 }).textContent),
    ).toEqual(["Inventario"]);
    expect(within(hub).getAllByRole("listitem")).toHaveLength(2);
  });

  it("sin `reports:read` la ruta rebota", async () => {
    await renderRuta("/reports", ["pos:sell"]);

    await waitFor(() => expect(screen.queryByTestId("reports-hub")).not.toBeInTheDocument());
  });

  describe("el nav", () => {
    it("con `reports:read` aparece la entrada de Reportes", async () => {
      await renderRuta("/reports", ["reports:read"]);

      expect(await screen.findByRole("link", { name: "Reportes generales" })).toBeInTheDocument();
    });

    /**
     * Se monta el HUB con un permiso de inventario —no la pantalla de venta—
     * para garantizar que el layout y su nav existen de verdad: si la ruta no
     * renderizara el nav, la ausencia del enlace no probaría nada.
     */
    it("sin `reports:read` la entrada no aparece, aunque el nav esté montado", async () => {
      await renderRuta("/movements/expiring", ["inventory:read"]);

      // El nav está: se ve otro grupo.
      expect(await screen.findByRole("link", { name: /vencer/i })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Reportes generales" })).not.toBeInTheDocument();
    });
  });
});
