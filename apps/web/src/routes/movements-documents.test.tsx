import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
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

const documento = (
  folio: string,
  status: "draft" | "confirmed" | "canceled" = "confirmed",
  fechas: { createdAt?: string; confirmedAt?: string | null; canceledAt?: string | null } = {},
) => ({
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
  canceledAt: null,
  ...fechas,
});

/**
 * F3-HOME-04. Un usuario con almacén ASIGNADO: el store lo lleva y el selector
 * del listado tiene que arrancar ahí.
 */
async function renderConAsignado(defaultWarehouseId: string | null) {
  useAuthStore.getState().setAuth("jwt-demo", {
    ...demoUser(["inventory:read", "inventory:movement"]),
    defaultWarehouseId,
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/movements/entries"] }),
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

  /**
   * La paginación de VERDAD (Carlos, 2026-08-25).
   *
   * El server siempre paginó a 20, pero la pantalla no mandaba `page` ni
   * pintaba botones: a partir del documento 21, los viejos simplemente
   * desaparecían del listado sin ningún aviso. Peor que no paginar — los
   * registros se perdían en silencio.
   */
  describe("la paginación (2026-08-25)", () => {
    it("con más registros que una página, aparece el paginador y pasa de página", async () => {
      mockedList.mockResolvedValue({
        rows: [documento("ENT-000042")],
        total: 45,
        page: 1,
        pageSize: 20,
      });
      await renderRuta("/movements/entries");
      await screen.findByText("ENT-000042");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /siguiente/i }));

      await waitFor(() =>
        expect(mockedList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
      );
    });

    it("cambiar un filtro VUELVE a la página 1", async () => {
      mockedList.mockResolvedValue({
        rows: [documento("ENT-000042")],
        total: 45,
        page: 2,
        pageSize: 20,
      });
      await renderRuta("/movements/entries");
      await screen.findByText("ENT-000042");
      const user = userEvent.setup();

      await user.click(screen.getByRole("button", { name: /siguiente/i }));
      await user.type(screen.getByPlaceholderText(/folio/i), "42");

      await waitFor(() =>
        expect(mockedList).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
      );
    });

    it("con una sola página el paginador no estorba", async () => {
      await renderRuta("/movements/entries");
      await screen.findByText("ENT-000042");

      expect(screen.queryByRole("button", { name: /siguiente/i })).not.toBeInTheDocument();
    });
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

    await user.click(screen.getByRole("button", { name: "Cancelados" }));

    await waitFor(() => {
      expect(mockedList).toHaveBeenCalledWith(expect.objectContaining({ status: "canceled" }));
    });
  });

  /**
   * F3-HOME-04. Con DOS almacenes el auto-select de `WarehouseSelect` (que
   * solo dispara con uno) no aplica: sin asignado había que elegir en cada
   * movimiento, que es la fricción que esto quita.
   */
  describe("el almacén asignado preselecciona (F3-HOME-04)", () => {
    const DOS = [
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
        name: "Bodega Norte",
        address: null,
        isActive: true,
        phone: null,
        email: null,
        attributes: {},
        deactivationBlockedBy: null,
      },
    ];

    it("con asignado, el documento nuevo sale de ESE almacén", async () => {
      const user = userEvent.setup();
      mockedWarehouses.mockResolvedValue(DOS);
      mockedCreate.mockResolvedValue({ ...documento("ENT-000043", "draft"), id: "nuevo-id" });
      await renderConAsignado("w2");
      await screen.findByText("ENT-000042");

      await user.click(screen.getByRole("button", { name: /crear/i }));

      await waitFor(() => {
        expect(mockedCreate.mock.calls[0]?.[0]).toEqual({ type: "entry", warehouseId: "w2" });
      });
    });

    /** Sin asignado y con dos opciones, sigue habiendo que elegir: nada cambia. */
    it("sin asignado el botón queda inhabilitado hasta que se elija", async () => {
      mockedWarehouses.mockResolvedValue(DOS);
      await renderConAsignado(null);
      await screen.findByText("ENT-000042");

      expect(screen.getByRole("button", { name: /crear/i })).toBeDisabled();
    });

    /**
     * Un asignado que NO está entre sus opciones (fuera de alcance o
     * desactivado) no se fuerza: se degrada al comportamiento de siempre en vez
     * de mandar un almacén que el API va a rechazar.
     */
    it("un asignado fuera de las opciones no se fuerza", async () => {
      mockedWarehouses.mockResolvedValue(DOS);
      await renderConAsignado("w-borrado");
      await screen.findByText("ENT-000042");

      expect(screen.getByRole("button", { name: /crear/i })).toBeDisabled();
    });
  });

  describe("crear", () => {
    it("el botón postea y navega al borrador recién creado", async () => {
      const user = userEvent.setup();
      mockedWarehouses.mockResolvedValue([
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

/**
 * Carlos (2026-09-01): con un inventario en borrador, «Crear» no hacía NADA
 * visible — el 409 del API se perdía en un `mutateAsync` sin catch. El
 * mensaje del servidor trae el folio abierto y se muestra tal cual.
 */
describe("crear con uno abierto (Carlos, 2026-09-01)", () => {
  it("el 409 se muestra con el folio que estorba y el botón vuelve a servir", async () => {
    const user = userEvent.setup();
    mockedWarehouses.mockResolvedValue([
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
    ]);
    mockedCreate.mockRejectedValue({
      statusCode: 409,
      message:
        "Ya hay un inventario físico abierto para este almacén (INV-000009). Cancélalo o confírmalo antes de empezar otro.",
    });
    const router = await renderRuta("/movements/counts");
    await screen.findByText("ENT-000042");

    await user.click(screen.getByRole("button", { name: /crear/i }));

    const alerta = await screen.findByRole("alert");
    expect(alerta).toHaveTextContent("INV-000009");
    expect(router.state.location.pathname).toBe("/movements/counts");
    expect(screen.getByRole("button", { name: /crear/i })).toBeEnabled();
  });
});

/**
 * Carlos (2026-09-02): la columna «Fecha» es la del ESTADO del documento —
 * apertura en borrador, asiento en confirmado, cancelación en cancelado— y
 * se lee en la zona del NEGOCIO, la misma con la que el API corta el rango
 * Desde/Hasta. Antes era siempre la apertura, en la zona del navegador.
 */
describe("la columna Fecha es la del estado, en la zona del negocio", () => {
  it("un confirmado muestra el día del asiento y explica los dos en el title", async () => {
    mockedList.mockResolvedValue({
      rows: [
        documento("ENT-000042", "confirmed", {
          createdAt: "2026-08-18T19:42:00.000Z",
          confirmedAt: "2026-08-20T16:00:00.000Z",
        }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderRuta("/movements/entries");
    const fila = (await screen.findByText("ENT-000042")).closest("tr") as HTMLElement;

    const celda = within(fila).getByText(/20\/08\/26/);
    expect(celda).toHaveAttribute(
      "title",
      expect.stringMatching(/Abierto.*18\/08\/26.*Confirmado.*20\/08\/26/),
    );
  });

  it("un borrador muestra la apertura, sin title", async () => {
    mockedList.mockResolvedValue({
      rows: [documento("ENT-000043", "draft", { confirmedAt: null })],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderRuta("/movements/entries");
    const fila = (await screen.findByText("ENT-000043")).closest("tr") as HTMLElement;

    const celda = within(fila).getByText(/18\/08\/26/);
    expect(celda).not.toHaveAttribute("title");
  });

  it("un instante de la madrugada UTC es el día ANTERIOR en CDMX", async () => {
    mockedList.mockResolvedValue({
      rows: [
        // 19 de agosto 03:30 UTC = 18 de agosto 21:30 en America/Mexico_City.
        documento("ENT-000044", "confirmed", { confirmedAt: "2026-08-19T03:30:00.000Z" }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderRuta("/movements/entries");
    const fila = (await screen.findByText("ENT-000044")).closest("tr") as HTMLElement;

    expect(within(fila).getByText(/18\/08\/26/)).toBeInTheDocument();
  });
});
