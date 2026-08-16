import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import * as catalogsApi from "../lib/catalogs/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F2-SCHEMA. Mismo arnés que `system-roles.test.tsx`: routeTree REAL,
 * `createQueryClient()`, API mockeada.
 *
 * Se testean DECISIONES (criterio de CONTRIBUTING): qué se envía al API, qué
 * se bloquea y qué diálogo aparece — no que una etiqueta esté escrita.
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
}));

const mockedApi = vi.mocked(catalogsApi);

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

const PRODUCTS_CATALOG = {
  id: "cat-products",
  name: "Catálogo de Productos",
  systemKey: "products",
  isSystem: true,
  isActive: true,
};

const UNITS_CATALOG = {
  id: "cat-units",
  name: "Unidad de Medida",
  systemKey: null,
  isSystem: false,
  isActive: true,
};

function textField(overrides: Partial<catalogsApi.CatalogField> = {}): catalogsApi.CatalogField {
  return {
    id: "f1",
    catalogId: "cat-products",
    key: "sustancia_activa",
    label: "Sustancia Activa",
    fieldType: "text",
    lookupCatalogId: null,
    required: false,
    position: 0,
    isArchived: false,
    ...overrides,
  };
}

async function renderSchema(permissions = ["catalogs:manage", "catalogs:read"]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/schema"] }),
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

describe("Editor de campos (F2-SCHEMA)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listCatalogs.mockResolvedValue([PRODUCTS_CATALOG, UNITS_CATALOG]);
    mockedApi.listFields.mockResolvedValue([]);
    mockedApi.listLookupOptions.mockResolvedValue([]);
  });

  it("sin catalogs:manage no se entra al editor (el gate no redirige, explica)", async () => {
    await renderSchema(["catalogs:read"]);

    // El gate NO redirige: muestra un panel explicando el motivo (D2).
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Agregar campo" })).not.toBeInTheDocument();
  });

  it("arranca en el catálogo del sistema, que el API devuelve primero", async () => {
    await renderSchema();

    // El campo pedido es el del catálogo de productos, no el del subcatálogo.
    await waitFor(() => expect(mockedApi.listFields).toHaveBeenCalledWith("cat-products"));
  });

  it("agregar un campo manda la ETIQUETA, nunca una key: la deriva el server", async () => {
    const user = userEvent.setup();
    mockedApi.createField.mockResolvedValue(textField());
    await renderSchema();
    await user.click(await screen.findByRole("button", { name: "Agregar campo" }));

    await user.type(screen.getByLabelText("Nombre del campo"), "Sustancia Activa");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mockedApi.createField).toHaveBeenCalledWith("cat-products", {
        label: "Sustancia Activa",
        fieldType: "text",
        required: false,
      }),
    );
    // La key NO viaja: si viajara, el usuario podría fabricar colisiones.
    expect(Object.keys(mockedApi.createField.mock.calls[0][1])).not.toContain("key");
  });

  it("un campo lookup exige catálogo destino antes de poder guardarse", async () => {
    const user = userEvent.setup();
    await renderSchema();
    await user.click(await screen.findByRole("button", { name: "Agregar campo" }));
    await user.type(screen.getByLabelText("Nombre del campo"), "Unidad");
    await user.selectOptions(screen.getByLabelText("Tipo"), "lookup");

    // Con el destino sin elegir, el submit está bloqueado.
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Catálogo al que apunta"), "cat-units");
    expect(screen.getByRole("button", { name: "Guardar" })).toBeEnabled();
  });

  it("el catálogo que se está editando NO se ofrece como destino de su propio lookup", async () => {
    const user = userEvent.setup();
    await renderSchema();
    await user.click(await screen.findByRole("button", { name: "Agregar campo" }));
    await user.selectOptions(screen.getByLabelText("Tipo"), "lookup");

    const target = screen.getByLabelText("Catálogo al que apunta");
    expect(target).not.toHaveTextContent("Catálogo de Productos");
    expect(target).toHaveTextContent("Unidad de Medida");
  });

  it("quitar un campo CON datos abre el diálogo con el conteo y solo entonces confirma", async () => {
    const user = userEvent.setup();
    mockedApi.listFields.mockResolvedValue([textField()]);
    // Primer intento: el API responde 409 con cuántos registros lo usan.
    mockedApi.removeField.mockRejectedValueOnce({
      statusCode: 409,
      message: "El campo tiene datos",
      error: "Conflict",
      recordCount: 847,
    });
    mockedApi.removeField.mockResolvedValueOnce({ archived: true });
    await renderSchema();

    await user.click(await screen.findByRole("button", { name: "Quitar" }));

    const dialog = await screen.findByTestId("remove-field-dialog");
    expect(dialog).toHaveTextContent("847");
    // Todavía NO se archivó: solo se preguntó.
    expect(mockedApi.removeField).toHaveBeenCalledTimes(1);
    expect(mockedApi.removeField).toHaveBeenLastCalledWith("cat-products", "f1", undefined);

    await user.click(screen.getByRole("button", { name: "Ocultar campo" }));

    await waitFor(() =>
      expect(mockedApi.removeField).toHaveBeenLastCalledWith("cat-products", "f1", true),
    );
  });

  it("un campo archivado ofrece restaurar y no editar: sus datos siguen ahí", async () => {
    const user = userEvent.setup();
    mockedApi.listFields.mockResolvedValue([textField({ isArchived: true })]);
    mockedApi.updateField.mockResolvedValue(textField());
    await renderSchema();

    expect(await screen.findByTestId("field-sustancia_activa-archived")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restaurar" }));

    await waitFor(() =>
      expect(mockedApi.updateField).toHaveBeenCalledWith("cat-products", "f1", {
        isArchived: false,
      }),
    );
  });

  it("el preview refleja los campos vigentes del catálogo elegido", async () => {
    mockedApi.listFields.mockResolvedValue([textField({ label: "Origen del Grano" })]);
    await renderSchema();

    // El campo aparece DOS veces: en la lista y en el formulario de preview.
    await waitFor(() => expect(screen.getAllByText(/Origen del Grano/).length).toBeGreaterThan(1));
  });
});
