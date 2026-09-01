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
    const payload = mockedApi.createField.mock.calls[0]?.[1];
    expect(payload && Object.keys(payload)).not.toContain("key");
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

  it("quitar un campo pregunta ANTES de tocar el API, aunque no tenga datos", async () => {
    // Antes se llamaba al API al primer clic: un campo sin datos se borraba de
    // verdad sin preguntar nada, y el diálogo solo aparecía si el 409 lo
    // forzaba.
    const user = userEvent.setup();
    mockedApi.listFields.mockResolvedValue([textField()]);
    mockedApi.removeField.mockResolvedValue({ archived: false });
    await renderSchema();

    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByTestId("remove-field-dialog")).toHaveTextContent("Sustancia Activa");
    expect(mockedApi.removeField).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Eliminar campo" }));

    await waitFor(() =>
      expect(mockedApi.removeField).toHaveBeenCalledWith("cat-products", "f1", undefined),
    );
  });

  it("un campo CON datos vuelve a preguntar, ahora con el conteo: ya no se borra, se oculta", async () => {
    const user = userEvent.setup();
    mockedApi.listFields.mockResolvedValue([textField()]);
    // El API responde 409 con cuántos registros lo usan.
    mockedApi.removeField.mockRejectedValueOnce({
      statusCode: 409,
      message: "El campo tiene datos",
      error: "Conflict",
      recordCount: 847,
    });
    mockedApi.removeField.mockResolvedValueOnce({ archived: true });
    await renderSchema();

    await user.click(await screen.findByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar campo" }));

    // Segunda pregunta, y NO es la misma: cambió lo que va a pasar (se oculta,
    // los valores se conservan) y ahora se sabe a cuántos registros afecta.
    const dialog = await screen.findByTestId("remove-field-dialog");
    expect(dialog).toHaveTextContent("847");
    expect(mockedApi.removeField).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Desactivar campo" }));

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
    expect(screen.queryByRole("button", { name: "Eliminar" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reactivar" }));

    await waitFor(() =>
      expect(mockedApi.updateField).toHaveBeenCalledWith("cat-products", "f1", {
        isArchived: false,
      }),
    );
  });

  it("el preview muestra TODOS los campos estándar, no solo el código (Carlos, 2026-09-01)", async () => {
    mockedApi.listFields.mockResolvedValue([textField()]);
    await renderSchema();
    await screen.findByText("Vienen con el catálogo y no se pueden quitar.");

    // La previsualización promete «así se ve el formulario» — mostrando solo
    // Código, mentía: el formulario real trae los cinco estándar.
    const preview = screen.getByTestId("schema-preview");
    for (const etiqueta of ["Código", "Nombre", "Unidad base", "Costo", "Precio"]) {
      expect(within(preview).getByLabelText(etiqueta)).toBeDisabled();
    }
  });

  it("el preview refleja los campos vigentes del catálogo elegido", async () => {
    mockedApi.listFields.mockResolvedValue([textField({ label: "Origen del Grano" })]);
    await renderSchema();

    // El campo aparece DOS veces: en la lista y en el formulario de preview.
    await waitFor(() => expect(screen.getAllByText(/Origen del Grano/).length).toBeGreaterThan(1));
  });
});

/**
 * ── ORDEN DE CAMPOS (2026-08-24, pedido de Carlos) ─────────────────────────
 *
 * Dos contratos: los chips estándar van en el orden del formulario de alta
 * (código, nombre, unidad base, costo, precio), y los campos personalizados
 * se reordenan con botones Subir/Bajar — botones y no arrastre, porque en un
 * teléfono el drag pelea con el scroll de la lista y acá tiene que funcionar
 * igual con dedo, ratón y teclado.
 */
describe("Orden de campos (F2-SCHEMA)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listCatalogs.mockResolvedValue([PRODUCTS_CATALOG, UNITS_CATALOG]);
    mockedApi.listFields.mockResolvedValue([]);
    mockedApi.listLookupOptions.mockResolvedValue([]);
    mockedApi.updateField.mockImplementation(async (_c, _f, input) => textField(input));
  });

  it("los chips estándar siguen el orden del formulario de alta", async () => {
    await renderSchema();

    const titulo = await screen.findByText("Campos estándar");
    const chips = [...(titulo.closest("section")?.querySelectorAll("li") ?? [])].map(
      (li) => li.textContent,
    );

    expect(chips).toEqual(["Código", "Nombre", "Unidad base", "Costo", "Precio"]);
  });

  const tresCampos = () => [
    textField({ id: "fa", key: "descripcion", label: "Descripción", position: 0 }),
    textField({ id: "fb", key: "proveedor", label: "Proveedor", position: 1 }),
    textField({ id: "fc", key: "laboratorio", label: "Laboratorio", position: 2 }),
  ];

  it("bajar un campo intercambia su posición con el siguiente", async () => {
    mockedApi.listFields.mockResolvedValue(tresCampos());
    await renderSchema();

    await userEvent.click(await screen.findByRole("button", { name: "Bajar Descripción" }));

    // Solo se tocan las filas cuya posición CAMBIA: Laboratorio queda igual.
    await waitFor(() => {
      expect(mockedApi.updateField).toHaveBeenCalledWith("cat-products", "fb", { position: 0 });
      expect(mockedApi.updateField).toHaveBeenCalledWith("cat-products", "fa", { position: 1 });
    });
    expect(mockedApi.updateField).toHaveBeenCalledTimes(2);
  });

  it("el primero no puede subir y el último no puede bajar", async () => {
    mockedApi.listFields.mockResolvedValue(tresCampos());
    await renderSchema();

    expect(await screen.findByRole("button", { name: "Subir Descripción" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Bajar Laboratorio" })).toBeDisabled();
    // Y los del medio pueden ambas cosas.
    expect(screen.getByRole("button", { name: "Subir Proveedor" })).toBeEnabled();
  });

  /**
   * Los campos creados antes de que la posición fuera del usuario nacieron
   * todos con `position: 0` y se ordenan por etiqueta. El primer movimiento
   * SANEA: persiste posición = índice en cada fila donde difieran, y de ahí
   * en adelante el orden es del usuario.
   */
  it("posiciones duplicadas heredadas se sanean al primer movimiento", async () => {
    mockedApi.listFields.mockResolvedValue([
      textField({ id: "fx", key: "aaa", label: "Aaa", position: 0 }),
      textField({ id: "fy", key: "bbb", label: "Bbb", position: 0 }),
      textField({ id: "fz", key: "ccc", label: "Ccc", position: 0 }),
    ]);
    await renderSchema();

    await userEvent.click(await screen.findByRole("button", { name: "Bajar Bbb" }));

    // Orden deseado: Aaa, Ccc, Bbb. Aaa ya está en 0: no se toca.
    await waitFor(() => {
      expect(mockedApi.updateField).toHaveBeenCalledWith("cat-products", "fz", { position: 1 });
      expect(mockedApi.updateField).toHaveBeenCalledWith("cat-products", "fy", { position: 2 });
    });
    expect(mockedApi.updateField).toHaveBeenCalledTimes(2);
  });
});

/**
 * ── RENOMBRAR SUBCATÁLOGOS (2026-08-24, pedido de Carlos) ─────────────────
 *
 * «Quiero editar el nombre de los subcatálogos. El único que no se puede es
 * el Catálogo de Productos.»
 *
 * El API ya lo permitía y ya protegía al de sistema con
 * `catalogs.system_cannot_be_renamed`; faltaba la pantalla — y el hook
 * `useUpdateCatalog` existía sin que nadie lo llamara.
 *
 * El botón NO aparece en el catálogo de sistema en vez de aparecer
 * deshabilitado: mismo criterio que los campos estándar, que se pintan sin
 * controles. Ofrecer algo que el servidor va a rechazar es hacer que el
 * usuario descubra la regla a los golpes.
 */
describe("Renombrar el catálogo (F2-SCHEMA)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listCatalogs.mockResolvedValue([PRODUCTS_CATALOG, UNITS_CATALOG]);
    mockedApi.listFields.mockResolvedValue([]);
    mockedApi.listLookupOptions.mockResolvedValue([]);
    mockedApi.updateCatalog.mockResolvedValue({ ...UNITS_CATALOG, name: "Proveedores" });
  });

  async function elegirSubcatalogo(user: ReturnType<typeof userEvent.setup>) {
    await user.selectOptions(await screen.findByRole("combobox"), "cat-units");
  }

  it("el catálogo de SISTEMA no ofrece renombrar", async () => {
    await renderSchema();

    // Arranca en el de productos (isSystem).
    await screen.findByRole("combobox");
    expect(screen.queryByRole("button", { name: /renombrar/i })).not.toBeInTheDocument();
  });

  it("un subcatálogo SÍ lo ofrece, y guarda el nombre nuevo", async () => {
    await renderSchema();
    const user = userEvent.setup();
    await elegirSubcatalogo(user);

    await user.click(await screen.findByRole("button", { name: /renombrar/i }));
    const campo = await screen.findByLabelText(/nombre del catálogo/i);
    await user.clear(campo);
    await user.type(campo, "Proveedores");
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => {
      expect(mockedApi.updateCatalog).toHaveBeenCalledWith("cat-units", { name: "Proveedores" });
    });
  });

  it("si el servidor lo rechaza, el error se VE y el formulario sigue abierto", async () => {
    mockedApi.updateCatalog.mockRejectedValue({
      statusCode: 409,
      message: "Ese catálogo del sistema no se puede renombrar.",
    });
    await renderSchema();
    const user = userEvent.setup();
    await elegirSubcatalogo(user);

    await user.click(await screen.findByRole("button", { name: /renombrar/i }));
    const campo = await screen.findByLabelText(/nombre del catálogo/i);
    await user.clear(campo);
    await user.type(campo, "Otro");
    await user.click(screen.getByRole("button", { name: /^guardar$/i }));

    // El error del servidor NUNCA se traga: lección del confirm mudo de F3.
    expect(await screen.findByText(/no se puede renombrar/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/nombre del catálogo/i)).toBeInTheDocument();
  });

  /**
   * ⚠ ESTADO ESPEJO. Al pasar de un subcatálogo a OTRO el componente no se
   * remonta —sigue montado porque los dos son no-sistema—, así que un `name`
   * inicializado solo en el `useState` arrastraría el nombre del anterior: el
   * usuario abriría «Renombrar» de Proveedores y vería «Unidad de Medida».
   * Es el C1 de f1-web-users con otra cara, y por eso el nombre se resiembra
   * al ABRIR y no solo al montar.
   */
  it("cambiar de subcatálogo NO arrastra el nombre del anterior", async () => {
    mockedApi.listCatalogs.mockResolvedValue([
      PRODUCTS_CATALOG,
      UNITS_CATALOG,
      { id: "cat-prov", name: "Proveedores", systemKey: null, isSystem: false, isActive: true },
    ]);
    await renderSchema();
    const user = userEvent.setup();

    await user.selectOptions(await screen.findByRole("combobox"), "cat-units");
    await user.click(await screen.findByRole("button", { name: /renombrar/i }));
    expect(await screen.findByLabelText(/nombre del catálogo/i)).toHaveValue("Unidad de Medida");

    // Se cierra, se cambia de catálogo y se vuelve a abrir.
    await user.click(screen.getByRole("button", { name: /cancelar/i }));
    await user.selectOptions(screen.getByRole("combobox"), "cat-prov");
    await user.click(await screen.findByRole("button", { name: /renombrar/i }));

    expect(await screen.findByLabelText(/nombre del catálogo/i)).toHaveValue("Proveedores");
  });

  it("un nombre vacío no se puede guardar", async () => {
    await renderSchema();
    const user = userEvent.setup();
    await elegirSubcatalogo(user);

    await user.click(await screen.findByRole("button", { name: /renombrar/i }));
    await user.clear(await screen.findByLabelText(/nombre del catálogo/i));

    expect(screen.getByRole("button", { name: /^guardar$/i })).toBeDisabled();
  });
});

/**
 * Campos estándar POR CATÁLOGO (2026-08-26): cada catálogo del sistema lista
 * los suyos — el ternario `isSystem ? [5 de producto] : [código]` mentía
 * para almacenes y servicios.
 */
describe("chips estándar de almacenes y servicios (2026-08-26)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listCatalogs.mockResolvedValue([
      {
        id: "cat-wh",
        name: "Catálogo de Almacenes",
        systemKey: "warehouses",
        isSystem: true,
        isActive: true,
      },
      PRODUCTS_CATALOG,
      {
        id: "cat-svc",
        name: "Catálogo de Servicios",
        systemKey: "services",
        isSystem: true,
        isActive: true,
      },
      UNITS_CATALOG,
    ]);
    mockedApi.listFields.mockResolvedValue([]);
    mockedApi.listLookupOptions.mockResolvedValue([]);
  });

  async function chipsDe(catalogId: string): Promise<(string | null)[]> {
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByRole("combobox"), catalogId);
    const titulo = await screen.findByText("Campos estándar");
    return [...(titulo.closest("section")?.querySelectorAll("li") ?? [])].map(
      (li) => li.textContent,
    );
  }

  it("almacenes lista su código y su contacto estándar (código desde 2026-09-01)", async () => {
    await renderSchema();
    expect(await chipsDe("cat-wh")).toEqual(["Código", "Nombre", "Dirección", "Teléfono", "Email"]);
  });

  it("servicios lista sus cuatro estándar — sin «Descripción» (Carlos, 2026-09-01)", async () => {
    await renderSchema();
    expect(await chipsDe("cat-svc")).toEqual(["Código", "Nombre", "Costo", "Precio"]);
  });

  it("productos conserva los cinco de siempre", async () => {
    await renderSchema();
    expect(await chipsDe("cat-products")).toEqual([
      "Código",
      "Nombre",
      "Unidad base",
      "Costo",
      "Precio",
    ]);
  });
});

describe("nuevo subcatálogo (Carlos, 2026-09-01)", () => {
  it("al nombrarlo sugiere el plural, con ejemplos", async () => {
    await renderSchema();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /nuevo subcatálogo/i }));

    const campo = await screen.findByLabelText(/nombre del subcatálogo/i);
    const leyenda = screen.getByText(/en plural/i);
    expect(leyenda).toHaveTextContent(/Proveedores/);
    expect(leyenda).toHaveTextContent(/Clientes/);
    expect(campo).toHaveAccessibleDescription(expect.stringMatching(/en plural/i));
  });
});
