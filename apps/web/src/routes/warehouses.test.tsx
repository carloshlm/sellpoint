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
import * as warehousesApi from "../lib/warehouses/api";
import * as importApi from "../lib/warehouses/import-api";
import { routeTree } from "../routeTree.gen";

/**
 * F3-GUARDS-03. El criterio del módulo: si el API tiene una guarda, la UI la
 * muestra ANTES del clic. Chocar con el 409 es el peor final posible — el
 * usuario ya se convenció de que iba a poder.
 */
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
  deleteWarehouse: vi.fn(),
}));
vi.mock("../lib/warehouses/import-api", () => ({
  downloadWarehouseImportTemplate: vi.fn(),
  runWarehouseImport: vi.fn(),
}));
vi.mock("../lib/catalogs/api", async (importOriginal) => ({
  ...(await importOriginal<typeof catalogsApi>()),
  listCatalogs: vi.fn(),
  listFields: vi.fn(),
}));

const mockedApi = vi.mocked(warehousesApi);
const mockedCatalogs = vi.mocked(catalogsApi);

/** Los tres catálogos del sistema, como los devuelve el API. */
const CATALOGOS_SISTEMA = [
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
] as catalogsApi.CatalogSummary[];

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
    posShowsStock: true,
    monthlySalesGoal: null,
  },
});

const almacen = (over: Partial<warehousesApi.Warehouse>): warehousesApi.Warehouse => ({
  id: "w1",
  code: "ALM-001",
  name: "Central",
  address: null,
  phone: null,
  email: null,
  attributes: {},
  isActive: true,
  deactivationBlockedBy: null,
  ...over,
});

async function renderWarehouses(permissions = ["warehouses:read", "warehouses:manage"]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/warehouses"] }),
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

/** El botón de desactivar/reactivar de una fila. */
function botonEstado(nombre: string) {
  const fila = screen.getByText(nombre).closest("tr");
  if (!fila) throw new Error(`no encontré la fila de ${nombre}`);
  const boton = Array.from(fila.querySelectorAll("button")).find(
    (b) => b.textContent === "Desactivar" || b.textContent === "Reactivar",
  );
  if (!boton) throw new Error(`no encontré el botón de estado de ${nombre}`);
  return boton;
}

/**
 * F3-GUARDS-03, revisado (Carlos, 2026-08-25): el botón bloqueado ya NO se
 * deshabilita — deshabilitado tenía `pointer-events: none` y el tooltip con
 * el motivo no podía aparecer nunca: parecía un botón muerto. Ahora el
 * `title` avisa al hover y el 409 del server cuenta el mismo motivo al clic.
 */
describe("Almacenes: la guarda se ve antes del clic (F3-GUARDS-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
  });

  it("con saldo, el botón sigue VIVO y el title dice por qué se va a rechazar", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "stock" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(botonEstado("Central")).toBeEnabled());
    expect(botonEstado("Central").title).toContain("existencias");
  });

  it("con traspasos en camino, el motivo es OTRO", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "transfers_in_transit" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(botonEstado("Central")).toBeEnabled());
    // Si los dos motivos dijeran lo mismo, el usuario no sabría qué hacer:
    // vaciar el almacén no destraba un traspaso en camino.
    expect(botonEstado("Central").title).toContain("camino");
  });

  it("el clic sobre uno bloqueado deja que el 409 del server explique", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "stock" }),
    ]);
    mockedApi.updateWarehouse.mockRejectedValue({
      statusCode: 409,
      message: "Este almacén todavía tiene existencias: muévelas antes de desactivarlo.",
    });
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(botonEstado("Central"));

    expect(await screen.findByTestId("warehouses-error")).toHaveTextContent("existencias");
  });

  it("sin bloqueo, el botón funciona y no lleva title", async () => {
    mockedApi.listWarehouses.mockResolvedValue([almacen({ id: "w1", name: "Central" })]);
    await renderWarehouses();

    await waitFor(() => expect(screen.getByText("Central")).toBeInTheDocument());
    expect(botonEstado("Central")).toBeEnabled();
    expect(botonEstado("Central").title).toBe("");
  });

  /**
   * Uno ya inactivo trae `deactivationBlockedBy: null` desde el API, pero
   * aunque llegara con motivo, reactivar nunca se bloquea: la guarda solo
   * corre al pasar de activo a inactivo.
   */
  it("reactivar nunca se bloquea", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", isActive: false, deactivationBlockedBy: "stock" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(screen.getByText("Central")).toBeInTheDocument());
    expect(botonEstado("Central")).toBeEnabled();
  });
});

/**
 * Eliminar un almacén (Carlos, 2026-08-25): solo uno que nunca operó. El 409
 * del API (has_history) se muestra — la salida no destructiva es desactivar.
 */
describe("Eliminar un almacén (2026-08-25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listWarehouses.mockResolvedValue([almacen({ id: "w1", name: "Central" })]);
  });

  it("el primer clic PREGUNTA nombrando el almacén; nada viaja todavía", async () => {
    const user = userEvent.setup();
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByTestId("delete-warehouse-dialog")).toHaveTextContent("Central");
    expect(mockedApi.deleteWarehouse).not.toHaveBeenCalled();
  });

  it("recién al confirmar se borra", async () => {
    const user = userEvent.setup();
    mockedApi.deleteWarehouse.mockResolvedValue(undefined);
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar almacén" }));

    await waitFor(() => expect(mockedApi.deleteWarehouse.mock.calls[0]?.[0]).toBe("w1"));
  });

  it("el 409 por historia se muestra y el diálogo se cierra", async () => {
    const user = userEvent.setup();
    mockedApi.deleteWarehouse.mockRejectedValue({
      statusCode: 409,
      message: "Este almacén ya tiene operaciones registradas: no se puede eliminar.",
    });
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar almacén" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("operaciones registradas");
    expect(screen.queryByTestId("delete-warehouse-dialog")).not.toBeInTheDocument();
  });
});

/**
 * Contacto estándar + campos dinámicos (Carlos, 2026-08-26): teléfono
 * compuesto país+número (E.164 canónico al guardar, patrón del teléfono del
 * negocio), email, y el DynamicForm del catálogo de sistema "warehouses".
 */
/**
 * Importar almacenes por Excel (Carlos, 2026-09-01): el mismo flujo de dos
 * pasos de productos y servicios, con el diálogo común de la casa.
 */
describe("importar almacenes (2026-09-01)", () => {
  beforeEach(() => {
    mockedCatalogs.listCatalogs.mockResolvedValue(CATALOGOS_SISTEMA);
    mockedCatalogs.listFields.mockResolvedValue([]);
    mockedApi.listWarehouses.mockResolvedValue([almacen({})]);
  });

  it("dry-run con reporte y aplicar solo tras verlo; al final, el cuadro verde", async () => {
    const user = userEvent.setup();
    const mockedRun = vi.mocked(importApi.runWarehouseImport);
    mockedRun.mockResolvedValue({
      valid: 2,
      failed: 0,
      created: 1,
      updated: 1,
      errors: [],
      applied: false,
    });
    await renderWarehouses();

    await user.click(await screen.findByRole("button", { name: "Importar almacenes" }));
    await user.upload(
      screen.getByLabelText("Elegir archivo"),
      new File([new Uint8Array([0x50, 0x4b])], "almacenes.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    // Primero el reporte SIN escribir: dry-run obligatorio.
    await waitFor(() =>
      expect(mockedRun).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true })),
    );
    expect(await screen.findByTestId("warehouse-import-report")).toHaveTextContent("1 altas");

    mockedRun.mockResolvedValue({
      valid: 2,
      failed: 0,
      created: 1,
      updated: 1,
      errors: [],
      applied: true,
    });
    await user.click(screen.getByRole("button", { name: "Importar" }));

    await waitFor(() =>
      expect(mockedRun).toHaveBeenLastCalledWith(expect.objectContaining({ skipErrors: false })),
    );
    const listo = await screen.findByTestId("warehouse-import-done");
    expect(listo).toHaveTextContent("2 almacenes");
    expect(listo).toHaveFocus();
  });
});

describe("contacto y campos dinámicos del almacén (2026-08-26)", () => {
  beforeEach(() => {
    // vi.mock persiste llamadas entre tests: sin el reset, `calls[0]` del
    // tercer test apuntaba al payload del primero.
    mockedApi.createWarehouse.mockReset();
    mockedCatalogs.listCatalogs.mockResolvedValue(CATALOGOS_SISTEMA);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("el alta compone el E.164 con el país del tenant preseleccionado y manda el email", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([]);
    mockedApi.createWarehouse.mockResolvedValue(almacen({ name: "Sucursal" }));
    await renderWarehouses();

    await user.click(await screen.findByRole("button", { name: "Nuevo almacén" }));

    // El país del NEGOCIO preselecciona el dial, como en Datos del negocio.
    expect(screen.getByLabelText("Código de país")).toHaveValue("MX");

    // El código es obligatorio desde 2026-09-01: sin él, Guardar no enciende.
    await user.type(screen.getByLabelText("Código"), "SUC-01");
    await user.type(screen.getByLabelText("Nombre del almacén"), "Sucursal");
    await user.type(screen.getByLabelText(/Teléfono/), "55 9988 7766");
    await user.type(screen.getByLabelText(/Email/), "sucursal@negocio.mx");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Sobre el PRIMER argumento: React Query le pasa al `mutationFn` un
    // segundo con el contexto de la mutación, que no es asunto del test.
    await waitFor(() => {
      expect(mockedApi.createWarehouse.mock.calls[0]?.[0]).toMatchObject({
        name: "Sucursal",
        phone: "+525599887766",
        email: "sucursal@negocio.mx",
      });
    });
  });

  /**
   * El código estándar (Carlos, 2026-09-01): obligatorio en el alta —el
   * botón no se enciende sin él— y viaja en el POST; el listado lo enseña
   * como primera columna, igual que el sku en productos.
   */
  it("el alta exige el código, lo manda, y el listado lo muestra", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([almacen({ code: "NORTE-01", name: "Norte" })]);
    mockedApi.createWarehouse.mockResolvedValue(almacen({ code: "SUR-01", name: "Sur" }));
    await renderWarehouses();

    expect(await screen.findByText("NORTE-01")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nuevo almacén" }));
    await user.type(screen.getByLabelText("Nombre del almacén"), "Sur");
    // Con nombre pero SIN código, Guardar sigue apagado.
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await user.type(screen.getByLabelText("Código"), "SUR-01");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockedApi.createWarehouse.mock.calls[0]?.[0]).toMatchObject({
        code: "SUR-01",
        name: "Sur",
      });
    });
  });

  it("al editar, el E.164 guardado se descompone en país + número", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ name: "Central", phone: "+525599887766", email: "central@negocio.mx" }),
    ]);
    await renderWarehouses();

    const fila = (await screen.findByText("Central")).closest("tr");
    const editar = Array.from(fila?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent === "Editar",
    );
    if (!editar) throw new Error("no encontré Editar");
    await user.click(editar);

    expect(screen.getByLabelText("Código de país")).toHaveValue("MX");
    expect(screen.getByLabelText(/Teléfono/)).toHaveValue("5599887766");
    expect(screen.getByLabelText(/Email/)).toHaveValue("central@negocio.mx");
  });

  it("pinta los campos dinámicos del catálogo de almacenes y los manda en attributes", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([]);
    mockedApi.createWarehouse.mockResolvedValue(almacen({ name: "Sucursal" }));
    mockedCatalogs.listFields.mockResolvedValue([
      {
        id: "f1",
        key: "encargado",
        label: "Encargado",
        fieldType: "text",
        lookupCatalogId: null,
        required: false,
        position: 1,
        isArchived: false,
      },
    ] as catalogsApi.CatalogField[]);
    await renderWarehouses();

    await user.click(await screen.findByRole("button", { name: "Nuevo almacén" }));
    await user.type(screen.getByLabelText("Código"), "SUC-02");
    await user.type(screen.getByLabelText("Nombre del almacén"), "Sucursal");
    await user.type(await screen.findByLabelText("Encargado"), "Rosa");
    expect(screen.getByLabelText("Encargado")).toHaveValue("Rosa");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockedApi.createWarehouse.mock.calls[0]?.[0]).toMatchObject({
        attributes: { encargado: "Rosa" },
      });
    });

    // Solo pide los campos del catálogo de ALMACENES, no el primero isSystem.
    expect(mockedCatalogs.listFields).toHaveBeenCalledWith("cat-wh");
  });
});

describe("buscador de almacenes (Carlos, 2026-09-01)", () => {
  beforeEach(() => {
    mockedCatalogs.listCatalogs.mockResolvedValue(CATALOGOS_SISTEMA);
    mockedCatalogs.listFields.mockResolvedValue([]);
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", code: "ALM-001", name: "Almacén Central", address: "Calle Central 5" }),
      almacen({ id: "w2", code: "ALM-002", name: "Almacén Norte", address: "Calle Norte 5" }),
      almacen({ id: "w3", code: "ALM-003", name: "Almacén Sur", address: null }),
    ]);
  });

  it("filtra por nombre sin distinguir mayúsculas; el resto de filas desaparece", async () => {
    await renderWarehouses();
    const user = userEvent.setup();
    expect(await screen.findByText("Almacén Norte")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/buscar almacén/i), "norte");

    expect(screen.getByText("Almacén Norte")).toBeInTheDocument();
    expect(screen.queryByText("Almacén Central")).not.toBeInTheDocument();
    expect(screen.queryByText("Almacén Sur")).not.toBeInTheDocument();
  });

  it("también encuentra por código y por dirección", async () => {
    await renderWarehouses();
    const user = userEvent.setup();
    const campo = await screen.findByLabelText(/buscar almacén/i);

    await user.type(campo, "alm-003");
    expect(screen.getByText("Almacén Sur")).toBeInTheDocument();
    expect(screen.queryByText("Almacén Norte")).not.toBeInTheDocument();

    await user.clear(campo);
    await user.type(campo, "calle central");
    expect(screen.getByText("Almacén Central")).toBeInTheDocument();
    expect(screen.queryByText("Almacén Sur")).not.toBeInTheDocument();
  });

  it("sin coincidencias lo dice, sin confundirlo con «no hay almacenes»", async () => {
    await renderWarehouses();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/buscar almacén/i), "zzz");

    expect(screen.getByTestId("warehouses-no-matches")).toBeInTheDocument();
    expect(screen.queryByTestId("warehouses-empty")).not.toBeInTheDocument();
  });
});

describe("el menú CATÁLOGO (Carlos, 2026-09-01)", () => {
  it("ordena Almacenes, Productos, Servicios, Campos y Subcatálogos", async () => {
    mockedCatalogs.listCatalogs.mockResolvedValue(CATALOGOS_SISTEMA);
    mockedCatalogs.listFields.mockResolvedValue([]);
    mockedApi.listWarehouses.mockResolvedValue([almacen({})]);
    await renderWarehouses([
      "warehouses:read",
      "products:read",
      "services:read",
      "catalogs:read",
      "catalogs:manage",
    ]);

    const grupo = await screen.findByRole("group", { name: "Catálogo" });
    const enlaces = within(grupo)
      .getAllByRole("link")
      .map((enlace) => enlace.textContent);
    expect(enlaces).toEqual(["Almacenes", "Productos", "Servicios", "Campos", "Subcatálogos"]);
  });
});
