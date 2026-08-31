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
  "/reports/sales",
  "/reports/stock",
];

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
 * Ocho tarjetas, tres comportamientos distintos:
 *  · Las que llevan a una PANTALLA (stock, ventas) navegan.
 *  · Las que son EXPORT DIRECTO (usuarios, almacenes, catálogo) descargan sin
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

  it("con `reports:read` se ven las ocho tarjetas", async () => {
    await renderRuta("/reports", ["reports:read", "inventory:read"]);

    const hub = await screen.findByTestId("reports-hub");
    expect(within(hub).getAllByRole("listitem")).toHaveLength(8);
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

  it("la de almacenes y la de catálogo también", async () => {
    await renderRuta("/reports", ["reports:read"]);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /almacenes/i }));
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

    expect(await screen.findByRole("link", { name: /stock por almacén/i })).toHaveAttribute(
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
    expect(within(hub).getAllByRole("listitem")).toHaveLength(6);
  });

  it("sin `reports:read` la ruta rebota", async () => {
    await renderRuta("/reports", ["pos:sell"]);

    await waitFor(() => expect(screen.queryByTestId("reports-hub")).not.toBeInTheDocument());
  });

  describe("el nav", () => {
    it("con `reports:read` aparece la entrada de Reportes", async () => {
      await renderRuta("/reports", ["reports:read"]);

      expect(await screen.findByRole("link", { name: "Reportes" })).toBeInTheDocument();
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
      expect(screen.queryByRole("link", { name: "Reportes" })).not.toBeInTheDocument();
    });
  });
});
