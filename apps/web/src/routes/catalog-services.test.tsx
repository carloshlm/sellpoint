import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import * as catalogsApi from "../lib/catalogs/api";
import { createQueryClient } from "../lib/query-client";
import * as servicesApi from "../lib/services/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

/**
 * F3-SVC-04 — el catálogo de Servicios (CU-CAT-08).
 *
 * Un servicio se vende pero NO mueve inventario: acá no hay almacén, ni
 * presentación, ni lote. Es el CRUD más simple del sistema a propósito.
 */
vi.mock("../lib/services/api", () => ({
  listServices: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  removeService: vi.fn(),
}));

vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
}));
vi.mock("../lib/catalogs/api", async (importOriginal) => ({
  ...(await importOriginal<typeof catalogsApi>()),
  listCatalogs: vi.fn(),
  listFields: vi.fn(),
}));

const mockedApi = vi.mocked(servicesApi);
const mockedCatalogs = vi.mocked(catalogsApi);
const mockedWarehouses = vi.mocked(warehousesApi.listWarehouses);

const ALMACENES: warehousesApi.Warehouse[] = [
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
    name: "Bodega Norte",
    address: null,
    phone: null,
    email: null,
    attributes: {},
    isActive: true,
    deactivationBlockedBy: null,
  },
];

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

const servicio = (over: Partial<servicesApi.Service> = {}): servicesApi.Service => ({
  id: "s1",
  code: "CORTE",
  name: "Corte de cabello",
  description: null,
  cost: "40",
  price: "150",
  isActive: true,
  warehouseIds: ["w1", "w2"],
  attributes: {},
  ...over,
});

async function renderServices(permissions = ["services:read", "services:manage"]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/services"] }),
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

describe("Catálogo de servicios (F3-SVC-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listServices.mockResolvedValue({
      rows: [servicio()],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mockedWarehouses.mockResolvedValue(ALMACENES);
  });

  it("lista los servicios con su código, nombre y precio", async () => {
    await renderServices();

    expect(await screen.findByText("Corte de cabello")).toBeInTheDocument();
    const fila = screen.getByText("Corte de cabello").closest("tr") as HTMLElement;
    expect(within(fila).getByText("CORTE")).toBeInTheDocument();
    expect(within(fila).getByText("150")).toBeInTheDocument();
  });

  it("crear un servicio manda código, nombre y precio", async () => {
    const user = userEvent.setup();
    mockedApi.createService.mockResolvedValue(servicio());
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Nuevo servicio" }));
    await user.type(screen.getByLabelText("Código"), "TINTE");
    await user.type(screen.getByLabelText("Nombre"), "Tinte");
    await user.type(screen.getByLabelText("Precio de venta"), "300");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      // React Query pasa su contexto como segundo argumento cuando el
      // `mutationFn` es la función del api directamente.
      expect(mockedApi.createService).toHaveBeenCalledWith(
        // F3-SVC-08: el alta nace con TODOS marcados — el negocio chico no
        // gestiona nada, y desmarcar es restringir.
        expect.objectContaining({
          code: "TINTE",
          name: "Tinte",
          price: 300,
          warehouseIds: ["w1", "w2"],
        }),
        expect.anything(),
      );
    });
  });

  it("desactivar manda isActive:false y no borra nada", async () => {
    const user = userEvent.setup();
    mockedApi.updateService.mockResolvedValue(servicio({ isActive: false }));
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Desactivar" }));

    await waitFor(() => {
      expect(mockedApi.updateService).toHaveBeenCalledWith("s1", { isActive: false });
    });
    expect(mockedApi.removeService).not.toHaveBeenCalled();
  });

  /** Borrar SÍ pide confirmación: es lo único de esta pantalla sin vuelta atrás. */
  it("eliminar pide confirmación antes de mandar el DELETE", async () => {
    const user = userEvent.setup();
    mockedApi.removeService.mockResolvedValue(undefined);
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(mockedApi.removeService).not.toHaveBeenCalled();

    await user.click(await screen.findByRole("button", { name: "Eliminar servicio" }));

    await waitFor(() =>
      expect(mockedApi.removeService).toHaveBeenCalledWith("s1", expect.anything()),
    );
  });

  it("el 409 de código repetido se muestra sin romper la tabla", async () => {
    const user = userEvent.setup();
    mockedApi.createService.mockRejectedValue(
      Object.assign(new Error("Ya tienes un servicio con ese código."), { statusCode: 409 }),
    );
    await renderServices();
    await screen.findByText("Corte de cabello");

    await user.click(screen.getByRole("button", { name: "Nuevo servicio" }));
    await user.type(screen.getByLabelText("Código"), "CORTE");
    await user.type(screen.getByLabelText("Nombre"), "Otro corte");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ya tienes un servicio con ese código.",
    );
    expect(screen.getByText("Corte de cabello")).toBeInTheDocument();
  });

  /**
   * F3-SVC-08 — el checklist de almacenes.
   *
   * Semántica EXPLÍCITA (decisión de Carlos): sin almacenes marcados el
   * servicio NO se vende en ningún lado. Por eso el alta nace con todos
   * marcados: el caso común no gestiona nada y desmarcar es restringir.
   */
  describe("los almacenes donde se ofrece (F3-SVC-08)", () => {
    /**
     * La respuesta visible al clic (Carlos, 2026-08-25): el form vive arriba
     * de la tabla y quien edita desde una fila lejana no lo ve aparecer. El
     * foco en el primer campo ES la prueba de que el usuario quedó ahí.
     */
    it("editar deja el foco en el PRIMER campo del formulario", async () => {
      const user = userEvent.setup();
      await renderServices();
      await screen.findByText("Corte de cabello");

      await user.click(screen.getByRole("button", { name: "Editar" }));

      expect(await screen.findByLabelText(/Código/)).toHaveFocus();
    });

    it("editar precarga los almacenes del servicio", async () => {
      const user = userEvent.setup();
      mockedApi.listServices.mockResolvedValue({
        rows: [servicio({ warehouseIds: ["w2"] })],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      await renderServices();
      await screen.findByText("Corte de cabello");

      await user.click(screen.getByRole("button", { name: "Editar" }));

      expect(await screen.findByTestId("service-warehouse-w2")).toBeChecked();
      expect(screen.getByTestId("service-warehouse-w1")).not.toBeChecked();
    });

    it("desmarcar restringe: el PATCH manda solo los que quedaron", async () => {
      const user = userEvent.setup();
      mockedApi.updateService.mockResolvedValue(servicio());
      await renderServices();
      await screen.findByText("Corte de cabello");

      await user.click(screen.getByRole("button", { name: "Editar" }));
      await user.click(await screen.findByTestId("service-warehouse-w2"));
      await user.click(screen.getByRole("button", { name: "Guardar" }));

      await waitFor(() =>
        expect(mockedApi.updateService).toHaveBeenCalledWith(
          "s1",
          // Sin `expect.anything()`: `updateService` va por un wrapper
          // (`({id, input}) => updateService(id, input)`), así que React Query
          // NO le pasa su contexto — al revés que `createService`.
          expect.objectContaining({ warehouseIds: ["w1"] }),
        ),
      );
    });

    it("«Deseleccionar todos» los quita, y vuelve a ofrecer seleccionarlos", async () => {
      const user = userEvent.setup();
      await renderServices();
      await screen.findByText("Corte de cabello");
      await user.click(screen.getByRole("button", { name: "Editar" }));

      await user.click(await screen.findByRole("button", { name: "Deseleccionar todos" }));
      expect(screen.getByTestId("service-warehouse-w1")).not.toBeChecked();
      expect(screen.getByTestId("service-warehouse-w2")).not.toBeChecked();

      // El botón alterna: con cero marcados ofrece seleccionarlos.
      await user.click(screen.getByRole("button", { name: "Seleccionar todos" }));
      expect(screen.getByTestId("service-warehouse-w1")).toBeChecked();
    });

    /** Cero almacenes es un estado VÁLIDO (un servicio en preparación), pero
     * el usuario tiene que saber que no se venderá en ningún lado. */
    it("con cero marcados avisa que no se venderá, y aun así guarda", async () => {
      const user = userEvent.setup();
      mockedApi.updateService.mockResolvedValue(servicio({ warehouseIds: [] }));
      await renderServices();
      await screen.findByText("Corte de cabello");
      await user.click(screen.getByRole("button", { name: "Editar" }));

      await user.click(await screen.findByRole("button", { name: "Deseleccionar todos" }));
      expect(screen.getByTestId("service-warehouses-empty-hint")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Guardar" }));
      await waitFor(() =>
        expect(mockedApi.updateService).toHaveBeenCalledWith(
          "s1",
          expect.objectContaining({ warehouseIds: [] }),
        ),
      );
    });

    it("el listado muestra en cuántos almacenes se ofrece", async () => {
      mockedApi.listServices.mockResolvedValue({
        rows: [servicio({ warehouseIds: ["w1"] })],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      await renderServices();

      const fila = (await screen.findByText("Corte de cabello")).closest("tr") as HTMLElement;
      expect(within(fila).getByText("1 de 2")).toBeInTheDocument();
    });
  });

  it("sin services:manage la pantalla es de solo lectura", async () => {
    await renderServices(["services:read"]);
    await screen.findByText("Corte de cabello");

    expect(screen.queryByRole("button", { name: "Nuevo servicio" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();
  });
});

/**
 * Campos dinámicos del servicio (Carlos, 2026-08-26): el form pinta los del
 * catálogo de sistema "services" (por systemKey, nunca `find(isSystem)`) y
 * los manda en `attributes`.
 */
describe("campos dinámicos del servicio (2026-08-26)", () => {
  beforeEach(() => {
    mockedApi.createService.mockReset();
    mockedCatalogs.listCatalogs.mockResolvedValue([
      {
        id: "cat-wh",
        name: "Catálogo de Almacenes",
        systemKey: "warehouses",
        isSystem: true,
        isActive: true,
      },
      {
        id: "cat-prod",
        name: "Catálogo de Productos",
        systemKey: "products",
        isSystem: true,
        isActive: true,
      },
      {
        id: "cat-svc",
        name: "Catálogo de Servicios",
        systemKey: "services",
        isSystem: true,
        isActive: true,
      },
    ] as catalogsApi.CatalogSummary[]);
    mockedCatalogs.listFields.mockResolvedValue([
      {
        id: "f1",
        key: "duracion",
        label: "Duración (min)",
        fieldType: "number",
        lookupCatalogId: null,
        required: false,
        position: 1,
        isArchived: false,
      },
    ] as catalogsApi.CatalogField[]);
  });

  it("pinta el campo dinámico y lo manda en attributes", async () => {
    const user = userEvent.setup();
    mockedApi.listServices.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    mockedWarehouses.mockResolvedValue(ALMACENES);
    mockedApi.createService.mockResolvedValue(servicio());
    await renderServices();

    await user.click(await screen.findByRole("button", { name: "Nuevo servicio" }));
    await user.type(screen.getByLabelText("Código"), "TINTE");
    await user.type(screen.getByLabelText("Nombre"), "Tinte");
    await user.type(await screen.findByLabelText("Duración (min)"), "45");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockedApi.createService.mock.calls[0]?.[0]).toMatchObject({
        code: "TINTE",
        attributes: { duracion: 45 },
      });
    });
    expect(mockedCatalogs.listFields).toHaveBeenCalledWith("cat-svc");
  });
});
