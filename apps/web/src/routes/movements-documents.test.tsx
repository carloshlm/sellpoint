import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../i18n";
import * as inventoryApi from "../lib/inventory/api";
import { createQueryClient } from "../lib/query-client";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-DOC-08 — el listado por serie.
 *
 * Las tres pantallas (Entradas, Salidas, Inventario) son **el mismo
 * componente** con distinto `type`. Que sea uno solo no es ahorro de código:
 * es la garantía de que las tres se comporten igual, porque para el usuario
 * son la misma pantalla con otro contenido.
 */
vi.mock("../lib/inventory/api", () => ({
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
}));

const mockedList = vi.mocked(inventoryApi.listDocuments);
const mockedCreate = vi.mocked(inventoryApi.createDocument);
const mockedWarehouses = vi.mocked(warehousesApi.listWarehouses);

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

const documento = (folio: string, status: "draft" | "confirmed" | "canceled" = "confirmed") => ({
  id: `id-${folio}`,
  folio,
  type: "entry" as const,
  status,
  warehouse: { id: "w1", name: "Central" },
  reasonCode: "invoice" as const,
  reference: "F-88213",
  lineCount: 3,
  createdAt: "2026-08-18T19:42:00.000Z",
  createdBy: { id: "u1", firstName: "Ana", lastNamePaternal: "Pérez" },
  confirmedAt: "2026-08-18T19:45:00.000Z",
});

async function renderRuta(
  path: string,
  permissions: string[] = ["inventory:read", "inventory:movement"],
) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
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
  return router;
}

beforeEach(() => {
  mockedList.mockReset();
  mockedCreate.mockReset();
  mockedWarehouses.mockReset();
  mockedWarehouses.mockResolvedValue([]);
  mockedList.mockResolvedValue({
    rows: [documento("ENT-000042")],
    total: 1,
    page: 1,
    pageSize: 20,
  });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Listado de documentos (F3-DOC-08)", () => {
  describe("el mismo componente, tres tipos", () => {
    it.each([
      ["/movements/entries", "entry"],
      ["/movements/exits", "exit"],
      ["/movements/counts", "physical_count"],
    ])("%s pide el tipo %s", async (path, type) => {
      await renderRuta(path);

      await waitFor(() => {
        expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ type }));
      });
    });
  });

  it("muestra el folio y sus datos", async () => {
    await renderRuta("/movements/entries");

    expect(await screen.findByText("ENT-000042")).toBeInTheDocument();
    expect(screen.getByText("Central")).toBeInTheDocument();
  });

  it("el estatus se pinta desde el DATO, no desde el copy", async () => {
    mockedList.mockResolvedValue({
      rows: [documento("ENT-000001", "draft")],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    await renderRuta("/movements/entries");

    expect(await screen.findByText("Borrador")).toBeInTheDocument();
  });

  it("escribir en el buscador manda `folio`", async () => {
    const user = userEvent.setup();
    await renderRuta("/movements/entries");
    await screen.findByText("ENT-000042");

    await user.type(screen.getByRole("searchbox"), "42");

    await waitFor(
      () => {
        expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ folio: "42" }));
      },
      { timeout: 2000 },
    );
  });

  /**
   * Los anulados no se muestran por defecto: crear un borrador es barato y va
   * a haber anulados vacíos que no tienen por qué ensuciar la vista de todos
   * los días. Pero se pueden pedir.
   */
  it("el chip de anulados cambia el filtro `status`", async () => {
    const user = userEvent.setup();
    await renderRuta("/movements/entries");
    await screen.findByText("ENT-000042");

    await user.click(screen.getByRole("button", { name: "Anulados" }));

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" }));
    });
  });

  describe("crear", () => {
    it("el botón postea y navega al borrador recién creado", async () => {
      const user = userEvent.setup();
      mockedWarehouses.mockResolvedValue([
        { id: "w1", name: "Central", address: null, isActive: true, deactivationBlockedBy: null },
      ]);
      mockedCreate.mockResolvedValue({ ...documento("ENT-000043", "draft"), id: "nuevo-id" });
      const router = await renderRuta("/movements/entries");
      await screen.findByText("ENT-000042");

      await user.click(screen.getByRole("button", { name: /crear/i }));

      // Sobre el PRIMER argumento: React Query le pasa al `mutationFn` un
      // segundo con el contexto de la mutación, que no es asunto del test.
      await waitFor(() => {
        expect(mockedCreate.mock.calls[0]?.[0]).toEqual({ type: "entry", warehouseId: "w1" });
      });
      await waitFor(() => {
        expect(router.state.location.pathname).toBe("/movements/documents/nuevo-id");
      });
    });

    /**
     * Quien AUDITA ve el listado pero no puede mover stock: el botón no existe
     * para él. Deshabilitarlo sería peor — sugiere que le falta un clic, no un
     * permiso.
     */
    it("sin `inventory:movement` el listado se ve pero el botón no existe", async () => {
      await renderRuta("/movements/entries", ["inventory:read"]);

      expect(await screen.findByText("ENT-000042")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /crear/i })).not.toBeInTheDocument();
    });
  });

  describe("estados vacíos", () => {
    it("distingue «todavía no hay» de «no encontré nada»", async () => {
      const user = userEvent.setup();
      mockedList.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });

      await renderRuta("/movements/entries");

      expect(await screen.findByText(/todavía no hay/i)).toBeInTheDocument();

      await user.type(screen.getByRole("searchbox"), "999");
      await waitFor(
        () => {
          expect(screen.getByText(/coincide/i)).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });
  });
});
