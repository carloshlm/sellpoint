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
import * as importApi from "../lib/catalogs/import-api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F2-SUBCAT. El ejemplo de Carlos: catálogo "Unidad de Medida" con Código +
 * un campo personalizado, y un lookup que lo referencia.
 */
vi.mock("../lib/catalogs/api", () => ({
  listCatalogs: vi.fn(),
  createCatalog: vi.fn(),
  updateCatalog: vi.fn(),
  listFields: vi.fn(),
  createField: vi.fn(),
  updateField: vi.fn(),
  removeField: vi.fn(),
  listRecords: vi.fn(),
  listLookupOptions: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  deleteRecord: vi.fn(),
}));

vi.mock("../lib/catalogs/import-api", () => ({
  downloadRecordsImportTemplate: vi.fn(),
  runRecordsImport: vi.fn(),
}));

const mockedApi = vi.mocked(catalogsApi);
const mockedImport = vi.mocked(importApi);

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

const UNITS = {
  id: "cat-units",
  name: "Unidad de Medida",
  systemKey: null,
  isSystem: false,
  isActive: true,
};
const PRODUCTS = {
  id: "cat-products",
  name: "Catálogo de Productos",
  systemKey: "products",
  isSystem: true,
  isActive: true,
};

const MEDIDA_FIELD: catalogsApi.CatalogField = {
  id: "f-medida",
  catalogId: "cat-units",
  key: "medida",
  label: "Medida",
  fieldType: "text",
  lookupCatalogId: null,
  required: true,
  position: 0,
  isArchived: false,
};

async function renderLists(permissions = ["catalogs:read", "catalogs:write"]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/lists"] }),
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

describe("Registros de subcatálogos (F2-SUBCAT)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listCatalogs.mockResolvedValue([PRODUCTS, UNITS]);
    mockedApi.listFields.mockResolvedValue([MEDIDA_FIELD]);
    mockedApi.listRecords.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    mockedApi.listLookupOptions.mockResolvedValue([]);
  });

  it("el catálogo de PRODUCTOS no aparece acá: tiene su propia pantalla", async () => {
    await renderLists();

    const selector = await screen.findByLabelText("Subcatálogo");
    expect(selector).toHaveTextContent("Unidad de Medida");
    expect(selector).not.toHaveTextContent("Catálogo de Productos");
  });

  it("las COLUMNAS salen de los campos del catálogo, no de una lista fija", async () => {
    mockedApi.listRecords.mockResolvedValue({
      rows: [
        {
          id: "r1",
          catalogId: "cat-units",
          code: "kg",
          attributes: { medida: "kilogramos" },
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderLists();

    const row = await screen.findByTestId("record-kg");
    expect(within(row).getByText("kilogramos")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Medida" })).toBeInTheDocument();
  });

  it("una celda de lookup muestra el código, no el UUID que guarda", async () => {
    mockedApi.listFields.mockResolvedValue([
      {
        ...MEDIDA_FIELD,
        id: "f-lookup",
        key: "unidad",
        label: "Unidad",
        fieldType: "lookup",
        lookupCatalogId: "cat-otro",
      },
    ]);
    mockedApi.listRecords.mockResolvedValue({
      rows: [
        {
          id: "r1",
          catalogId: "cat-units",
          code: "azucar",
          attributes: { unidad: "uuid-kg" },
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mockedApi.listLookupOptions.mockResolvedValue([
      { id: "uuid-kg", code: "kg", display: "kilogramos" },
    ]);
    await renderLists();

    const row = await screen.findByTestId("record-azucar");
    await waitFor(() => expect(within(row).getByText("kg — kilogramos")).toBeInTheDocument());
    expect(within(row).queryByText("uuid-kg")).not.toBeInTheDocument();
  });

  it("el alta manda el código y los atributos dinámicos juntos", async () => {
    const user = userEvent.setup();
    mockedApi.createRecord.mockResolvedValue({
      id: "r1",
      catalogId: "cat-units",
      code: "kg",
      attributes: { medida: "kilogramos" },
      isActive: true,
    });
    await renderLists();

    await user.click(await screen.findByRole("button", { name: "Nuevo registro" }));
    await user.type(screen.getByLabelText("Código"), "kg");
    await user.type(screen.getByLabelText("Medida *"), "kilogramos");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mockedApi.createRecord).toHaveBeenCalledWith("cat-units", {
        code: "kg",
        attributes: { medida: "kilogramos" },
      }),
    );
  });

  it("un error POR CAMPO del API se pinta bajo su input, no como mensaje suelto", async () => {
    const user = userEvent.setup();
    mockedApi.createRecord.mockRejectedValue({
      statusCode: 400,
      message: "Atributos inválidos",
      error: "Bad Request",
      errors: [{ key: "medida", message: "catalogs.field_required" }],
    });
    await renderLists();

    await user.click(await screen.findByRole("button", { name: "Nuevo registro" }));
    await user.type(screen.getByLabelText("Código"), "gr");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // El mensaje aparece asociado al campo, no en el bloque de error general.
    await waitFor(() => expect(screen.getByLabelText("Medida *")).toBeInvalid());
    expect(screen.queryByTestId("record-form-error")).not.toBeInTheDocument();
  });

  it("el 409 al archivar un registro referenciado se muestra y la fila NO desaparece", async () => {
    const user = userEvent.setup();
    mockedApi.listRecords.mockResolvedValue({
      rows: [
        {
          id: "r1",
          catalogId: "cat-units",
          code: "kg",
          attributes: { medida: "kilogramos" },
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mockedApi.updateRecord.mockRejectedValue({
      statusCode: 409,
      message: "Lo usa el campo Unidad",
      error: "Conflict",
    });
    await renderLists();

    await user.click(await screen.findByRole("button", { name: "Desactivar" }));

    expect(await screen.findByTestId("records-error")).toHaveTextContent("Lo usa el campo Unidad");
    expect(screen.getByTestId("record-kg")).toBeInTheDocument();
  });

  it("sin catalogs:write se puede leer pero no aparecen acciones de escritura", async () => {
    mockedApi.listRecords.mockResolvedValue({
      rows: [
        {
          id: "r1",
          catalogId: "cat-units",
          code: "kg",
          attributes: { medida: "kilogramos" },
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderLists(["catalogs:read"]);

    expect(await screen.findByTestId("record-kg")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo registro" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar" })).not.toBeInTheDocument();
  });
});

/**
 * Eliminar un registro (Carlos, 2026-08-25): uno libre se borra de verdad; el
 * 409 de uno referenciado por lookup se muestra sin que la fila desaparezca.
 */
/**
 * Importar registros por Excel (Carlos, 2026-09-01): para CUALQUIER
 * subcatálogo, con el diálogo común. El endpoint va parametrizado por el
 * catálogo que está seleccionado en pantalla.
 */
describe("importar registros de un subcatálogo (2026-09-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listCatalogs.mockResolvedValue([PRODUCTS, UNITS]);
    mockedApi.listFields.mockResolvedValue([MEDIDA_FIELD]);
    mockedApi.listRecords.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    mockedApi.listLookupOptions.mockResolvedValue([]);
  });

  it("la plantilla y el dry-run van al subcatálogo elegido; al aplicar, cuadro verde con foco", async () => {
    const user = userEvent.setup();
    mockedImport.downloadRecordsImportTemplate.mockResolvedValue(undefined);
    mockedImport.runRecordsImport.mockResolvedValue({
      valid: 3,
      failed: 0,
      created: 2,
      updated: 1,
      errors: [],
      applied: false,
    });
    await renderLists();

    await user.click(await screen.findByRole("button", { name: "Importar" }));
    await user.click(screen.getByRole("button", { name: "Plantilla Excel" }));
    expect(mockedImport.downloadRecordsImportTemplate).toHaveBeenCalledWith("cat-units");

    await user.upload(
      screen.getByLabelText("Elegir archivo"),
      new File([new Uint8Array([0x50, 0x4b])], "laboratorios.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    await waitFor(() =>
      expect(mockedImport.runRecordsImport).toHaveBeenCalledWith(
        "cat-units",
        expect.objectContaining({ dryRun: true }),
      ),
    );
    expect(await screen.findByTestId("records-import-report")).toHaveTextContent("2 altas");

    mockedImport.runRecordsImport.mockResolvedValue({
      valid: 3,
      failed: 0,
      created: 2,
      updated: 1,
      errors: [],
      applied: true,
    });
    // Dos botones dicen «Importar» (el de la cabecera ya no: se esconde
    // mientras el diálogo está abierto); el del reporte es el que aplica.
    await user.click(screen.getByRole("button", { name: "Importar" }));

    const listo = await screen.findByTestId("records-import-done");
    expect(listo).toHaveTextContent("3 registros");
    expect(listo).toHaveFocus();
  });
});

describe("Eliminar un registro (2026-08-25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listCatalogs.mockResolvedValue([PRODUCTS, UNITS]);
    mockedApi.listFields.mockResolvedValue([MEDIDA_FIELD]);
    mockedApi.listLookupOptions.mockResolvedValue([]);
    mockedApi.listRecords.mockResolvedValue({
      rows: [
        {
          id: "r1",
          catalogId: "cat-units",
          code: "kg",
          attributes: { medida: "kilogramos" },
          isActive: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
  });

  it("el primer clic PREGUNTA nombrando el código; nada viaja todavía", async () => {
    const user = userEvent.setup();
    await renderLists(["catalogs:read", "catalogs:write"]);
    await screen.findByText("kg");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByTestId("delete-record-dialog")).toHaveTextContent("kg");
    expect(mockedApi.deleteRecord).not.toHaveBeenCalled();
  });

  it("recién al confirmar se borra", async () => {
    const user = userEvent.setup();
    mockedApi.deleteRecord.mockResolvedValue(undefined);
    await renderLists(["catalogs:read", "catalogs:write"]);
    await screen.findByText("kg");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar registro" }));

    await waitFor(() =>
      expect(mockedApi.deleteRecord.mock.calls[0]?.slice(0, 2)).toEqual(["cat-units", "r1"]),
    );
  });

  it("el 409 de uno referenciado se muestra y la fila no desaparece", async () => {
    const user = userEvent.setup();
    mockedApi.deleteRecord.mockRejectedValue({
      statusCode: 409,
      message: "Este registro está referenciado por un lookup.",
    });
    await renderLists(["catalogs:read", "catalogs:write"]);
    await screen.findByText("kg");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar registro" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("referenciado");
    expect(screen.getByText("kg")).toBeInTheDocument();
  });
});

describe("buscador de registros (Carlos, 2026-09-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedApi.listCatalogs.mockResolvedValue([PRODUCTS, UNITS]);
    mockedApi.listFields.mockResolvedValue([MEDIDA_FIELD]);
    mockedApi.listRecords.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
    mockedApi.listLookupOptions.mockResolvedValue([]);
  });

  it("lo que se escribe viaja al API como búsqueda, desde la página 1", async () => {
    await renderLists();
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/buscar registro/i), "hugo");

    await waitFor(() => {
      expect(mockedApi.listRecords).toHaveBeenCalledWith("cat-units", 1, "hugo");
    });
  });

  it("sin coincidencias lo dice, sin confundirlo con «no hay registros»", async () => {
    await renderLists();
    const user = userEvent.setup();
    expect(await screen.findByTestId("records-empty")).toBeInTheDocument();

    await user.type(screen.getByLabelText(/buscar registro/i), "zzz");

    expect(await screen.findByTestId("records-no-matches")).toBeInTheDocument();
    expect(screen.queryByTestId("records-empty")).not.toBeInTheDocument();
  });
});
