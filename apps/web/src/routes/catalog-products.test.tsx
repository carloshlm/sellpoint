import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { createI18n } from "../i18n";
import * as catalogsApi from "../lib/catalogs/api";
import * as productsApi from "../lib/products/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F2-PROD. Borrar un producto se lleva sus presentaciones, sus códigos de
 * barras y su composición — y era la ÚNICA acción destructiva del sistema que
 * no preguntaba nada (lo reportó Carlos con una captura del botón "Quitar").
 */
vi.mock("../lib/products/api", () => ({
  listProducts: vi.fn(),
  getProduct: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  listPresentations: vi.fn(),
  createPresentation: vi.fn(),
  updatePresentation: vi.fn(),
  deletePresentation: vi.fn(),
  getComposition: vi.fn(),
  replaceComposition: vi.fn(),
  getAvailability: vi.fn(),
  getCostEstimate: vi.fn(),
}));

vi.mock("../lib/catalogs/api", () => ({
  listCatalogs: vi.fn(),
  listFields: vi.fn(),
  listLookupOptions: vi.fn(),
}));
vi.mock("@/lib/tenant/tax-api", () => ({
  getTaxSettings: vi.fn().mockResolvedValue({
    mode: "included",
    country: "MX",
    region: null,
    needsRegion: false,
    hasSales: false,
    groups: [
      {
        id: "tg-vat",
        code: "VAT16",
        name: "IVA 16%",
        isDefault: true,
        isActive: true,
        sortOrder: 0,
        usageCount: 0,
        rates: [{ code: "VAT", name: "IVA 16%", rate: "16" }],
      },
      {
        id: "tg-ex",
        code: "EXEMPT",
        name: "Exento",
        isDefault: false,
        isActive: true,
        sortOrder: 1,
        usageCount: 0,
        rates: [],
      },
    ],
  }),
  updateTaxSettings: vi.fn(),
  deleteTaxGroup: vi.fn(),
}));

const mockedProducts = vi.mocked(productsApi);
const mockedCatalogs = vi.mocked(catalogsApi);

const demoUser = (
  permissions: string[],
  costTaxMode: "included" | "excluded" = "excluded",
  taxMode: "included" | "excluded" = "included",
): AuthUser => buildAuthUser({ permissions, tenant: buildTenantBlock({ costTaxMode, taxMode }) });

const PRODUCT: productsApi.ProductDetail = {
  id: "prod-1",
  sku: "AZUCAR1GR001",
  name: "Azucar",
  baseUnit: "gr",
  isComposite: false,
  isActive: true,
  attributes: {},
  taxGroupId: null,
  stockMin: "0",
  location: null,
  presentations: [],
};

async function openProduct(
  costTaxMode: "included" | "excluded" = "excluded",
  taxMode: "included" | "excluded" = "included",
) {
  useAuthStore
    .getState()
    .setAuth("jwt", demoUser(["products:read", "products:manage"], costTaxMode, taxMode));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );

  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^Ver / }));
  return user;
}

describe("Borrar un producto (F2-PROD)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.02" }],
    });
    mockedProducts.getProduct.mockResolvedValue(PRODUCT);
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("el primer clic en «Quitar» PREGUNTA y nombra el producto", async () => {
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Eliminar" }));

    expect(await screen.findByTestId("remove-product-dialog")).toHaveTextContent("Azucar");
    expect(mockedProducts.deleteProduct).not.toHaveBeenCalled();
  });

  it("recién al confirmar se borra", async () => {
    mockedProducts.deleteProduct.mockResolvedValue(undefined);
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar producto" }));

    await waitFor(() => expect(mockedProducts.deleteProduct).toHaveBeenCalled());
    expect(mockedProducts.deleteProduct.mock.calls[0]?.[0]).toBe("prod-1");
    // De vuelta en la lista, el éxito se VE (Carlos, 2026-09-12): verde y con el foco.
    const aviso = await screen.findByTestId("product-deleted");
    expect(aviso).toHaveTextContent("Se eliminó el producto «Azucar».");
    expect(aviso).toHaveFocus();
  });

  it("cancelar cierra el diálogo y no borra nada", async () => {
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Eliminar" }));
    // El "Cancelar" DEL DIÁLOGO: el formulario tiene el suyo, y buscar por
    // texto suelto agarraría cualquiera de los dos.
    const dialog = await screen.findByTestId("remove-product-dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByTestId("remove-product-dialog")).not.toBeInTheDocument();
    expect(mockedProducts.deleteProduct).not.toHaveBeenCalled();
  });

  it("si el API lo rechaza (es componente de otro), el diálogo se cierra y el motivo se ve", async () => {
    // Insistir con el mismo botón no lo arreglaría: hay que deshacer la
    // composición primero.
    mockedProducts.deleteProduct.mockRejectedValue({
      statusCode: 409,
      message: "No se puede eliminar: este producto es componente de otro.",
      error: "Conflict",
    });
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar producto" }));

    await waitFor(() =>
      expect(screen.queryByTestId("remove-product-dialog")).not.toBeInTheDocument(),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("componente de otro");
  });
});

/**
 * F3-LOTS-01 — el opt-in al control de lote y caducidad.
 *
 * Encender siempre se puede; apagar con saldo asignado a lotes, no — dejaría
 * las filas de `stock_lots` huérfanas. La pantalla lo dice ANTES: un checkbox
 * deshabilitado con su explicación es mejor que un 409 después de intentarlo.
 */
/**
 * Desactivar un producto (Carlos, 2026-08-25): el aviso de "no se puede
 * borrar porque tiene movimientos" recomendaba desactivarlo… y la acción no
 * existía en ninguna pantalla. El API siempre la aceptó (isActive en el
 * PATCH); faltaba la puerta.
 */
describe("Desactivar y reactivar un producto", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.02" }],
    });
    mockedProducts.getProduct.mockResolvedValue(PRODUCT);
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("un producto activo ofrece «Desactivar» y el PATCH apaga isActive", async () => {
    mockedProducts.updateProduct.mockResolvedValue({ ...PRODUCT, isActive: false });
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Desactivar" }));

    await waitFor(() => {
      expect(mockedProducts.updateProduct).toHaveBeenCalledWith("prod-1", { isActive: false });
    });
  });

  it("un producto inactivo ofrece «Reactivar» y el PATCH lo enciende", async () => {
    mockedProducts.getProduct.mockResolvedValue({ ...PRODUCT, isActive: false });
    mockedProducts.updateProduct.mockResolvedValue(PRODUCT);
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Reactivar" }));

    await waitFor(() => {
      expect(mockedProducts.updateProduct).toHaveBeenCalledWith("prod-1", { isActive: true });
    });
  });

  /**
   * Carlos (2026-08-29): «para poder deshabilitar un producto no debe tener
   * stock en ningún almacén». El server lo rechaza con 409 — y el botón de
   * la FILA no tenía `onError`, así que el clic no habría hecho nada visible
   * y el usuario habría creído que la app se colgó.
   */
  it("si el server rechaza por existencias, la lista dice dónde está el stock", async () => {
    useAuthStore.getState().setAuth("jwt", demoUser(["products:read", "products:manage"]));
    mockedProducts.updateProduct.mockRejectedValue({
      statusCode: 409,
      code: "products.stock_in_warehouses",
      message: "No se puede desactivar: el producto todavía tiene existencias en 2 almacén(es).",
      warehouses: [
        { name: "Almacén Central", quantity: "255.5" },
        { name: "Almacén Sur", quantity: "30" },
      ],
    });
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Desactivar" }));

    const aviso = await screen.findByTestId("product-action-error");
    expect(aviso).toHaveTextContent(/todavía tiene existencias/);
    // El DÓNDE y el CUÁNTO: sin eso el usuario no sabe qué salida capturar.
    expect(aviso).toHaveTextContent("Almacén Central: 255.5");
    expect(aviso).toHaveTextContent("Almacén Sur: 30");
  });

  it("el listado marca los inactivos: un producto apagado sin señal parece un bug de stock", async () => {
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.02", isActive: false }],
    });
    useAuthStore.getState().setAuth("jwt", demoUser(["products:read", "products:manage"]));
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    expect(await screen.findByText("Inactivo")).toBeInTheDocument();
  });
});

/**
 * F9-COSTMODE-10 — la etiqueta del costo dice en qué base captura el negocio
 * (`tenants.cost_tax_mode`), y lo tecleado viaja tal cual: el web no convierte.
 */
describe("la base del costo en la ficha (F9-COSTMODE-10)", () => {
  it("capturando «con impuesto» la etiqueta lo dice y el número viaja sin convertir", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: false,
    });
    mockedProducts.updateProduct.mockResolvedValue({ ...PRODUCT });
    const user = await openProduct("included");
    const costo = await screen.findByLabelText("Costo (con impuesto incluido)");
    expect(screen.getByText(/con el impuesto adentro/)).toBeInTheDocument();
    await user.clear(costo);
    await user.type(costo, "116");
    await user.click(screen.getByRole("button", { name: /Guardar/ }));
    await waitFor(() =>
      expect(mockedProducts.updateProduct).toHaveBeenCalledWith(
        "prod-1",
        expect.objectContaining({ cost: 116 }),
      ),
    );
  });

  /**
   * Carlos, 2026-09-12: «aún es confuso poner el costo y el precio». El bloque
   * pone el impuesto ANTES de los dos importes (decide cómo se leen), dice la
   * regla del negocio arriba con enlace a Mi perfil, y debajo del precio
   * muestra lo que verá el cliente en el ticket con el impuesto aplicado.
   */
  it("el impuesto va antes que el costo y el precio; la regla del negocio se lee arriba", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: false,
    });
    await openProduct();
    const impuesto = await screen.findByLabelText("Impuesto");
    const costo = screen.getByLabelText("Costo (sin impuesto)");
    const precio = screen.getByLabelText("Precio de venta (con impuesto incluido)");
    const antes = (a: Element, b: Element) =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(antes(impuesto, costo)).toBe(true);
    expect(antes(costo, precio)).toBe(true);
    const regla = screen.getByTestId("pricing-rule");
    expect(regla).toHaveTextContent("el costo se captura SIN impuesto");
    expect(regla).toHaveTextContent("El precio de venta va CON el impuesto incluido");
    expect(
      within(regla).getByRole("link", { name: "Cambiar en Mi perfil › Impuestos" }),
    ).toHaveAttribute("href", "/profile");
  });

  it("México: el precio muestra en vivo cuánto IVA lleva adentro", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: false,
    });
    const user = await openProduct();
    const precio = await screen.findByLabelText("Precio de venta (con impuesto incluido)");
    await user.clear(precio);
    await user.type(precio, "23");
    // 23.00 con IVA 16% adentro: 19.83 + 3.17.
    await waitFor(() =>
      expect(screen.getByTestId("price-breakdown")).toHaveTextContent(
        /En el ticket: \$23\.00, que ya incluye \$3\.17 de IVA 16%\./,
      ),
    );
    expect(screen.queryByTestId("cost-breakdown")).not.toBeInTheDocument();
  });

  it("Canadá: precio sin impuesto → el ticket lo suma; costo con impuesto → se muestra el neto", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: false,
    });
    const user = await openProduct("included", "excluded");
    const precio = await screen.findByLabelText("Precio de venta (sin impuesto)");
    expect(screen.getByTestId("pricing-rule")).toHaveTextContent(
      "El precio de venta va SIN impuesto",
    );
    await user.clear(precio);
    await user.type(precio, "23");
    await waitFor(() =>
      expect(screen.getByTestId("price-breakdown")).toHaveTextContent(
        /En el ticket: \$23\.00 \+ \$3\.68 de IVA 16% = \$26\.68\./,
      ),
    );
    const costo = screen.getByLabelText("Costo (con impuesto incluido)");
    await user.clear(costo);
    await user.type(costo, "116");
    await waitFor(() =>
      expect(screen.getByTestId("cost-breakdown")).toHaveTextContent(/Sin impuesto: \$100\.00\./),
    );
  });

  it("capturando «sin impuesto» (el default) la etiqueta dice sin impuesto", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: false,
    });
    await openProduct();
    expect(await screen.findByLabelText("Costo (sin impuesto)")).toBeInTheDocument();
    expect(screen.getByText(/antes del impuesto/)).toBeInTheDocument();
  });
});

describe("Control por lote de un producto (F3-LOTS-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.02" }],
    });
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("los dos interruptores explican qué pasa al encenderlos (Carlos, 2026-09-05)", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: false,
    });
    await openProduct();
    expect(await screen.findByText(/Las entradas te pedirán lote y caducidad/)).toBeInTheDocument();
    expect(
      screen.getByText(/se descuentan las existencias de sus componentes/),
    ).toBeInTheDocument();
  });

  it("sin saldo por lote el checkbox se puede tocar y viaja en el PATCH", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: false,
    });
    mockedProducts.updateProduct.mockResolvedValue(PRODUCT);
    const user = await openProduct();

    const checkbox = await screen.findByLabelText(/controla por lote/i);
    expect(checkbox).toBeEnabled();

    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: /guardar/i }));

    await waitFor(() => {
      expect(mockedProducts.updateProduct).toHaveBeenCalledWith(
        "prod-1",
        expect.objectContaining({ tracksLots: true }),
      );
    });
  });

  /**
   * El `title` no es decoración: es el ÚNICO lugar donde el usuario se entera
   * de por qué no puede. Un checkbox gris sin explicación se lee como un bug.
   */
  it("con saldo por lote el checkbox va deshabilitado y explica por qué", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: true,
      hasLotStock: true,
    });
    await openProduct();

    const checkbox = await screen.findByLabelText(/controla por lote/i);

    expect(checkbox).toBeDisabled();
    expect(checkbox).toHaveAttribute(
      "title",
      expect.stringMatching(/existencias asignadas a lotes/i),
    );
  });

  /** Con saldo pero ya APAGADO no hay nada que proteger: encenderlo se puede. */
  it("con saldo por lote pero el control apagado, se puede encender", async () => {
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      tracksLots: false,
      hasLotStock: true,
    });
    await openProduct();

    expect(await screen.findByLabelText(/controla por lote/i)).toBeEnabled();
  });
});

/**
 * Reportado por Carlos: estando en el Kardex de un producto, hacer clic en
 * "Productos" en el menú no lo devolvía al listado.
 *
 * No era un clic perdido. El producto abierto vivía en un `useState`, así que
 * el listado y el detalle compartían la URL `/catalog/products` — y el menú
 * apuntaba a la URL en la que ya estabas. El router no tenía a dónde ir.
 *
 * Por eso el test navega de VERDAD, con el enlace del menú, en vez de llamar a
 * un `onBack`: lo que estaba roto era la navegación, no el botón de volver.
 */
describe("El menú devuelve al listado (bug de navegación)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({
      items: [{ ...PRODUCT, price: "0.02" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    mockedProducts.getProduct.mockResolvedValue(PRODUCT);
    mockedProducts.listPresentations.mockResolvedValue([]);
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("abrir un producto lo deja en la URL, no escondido en el estado", async () => {
    useAuthStore.getState().setAuth("jwt", demoUser(["products:read"]));
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Ver / }));

    // Se lee del ROUTER y no de `window.location`: con `createMemoryHistory`
    // la barra del navegador no se toca, así que mirar ahí daría un falso rojo.
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ open: "prod-1" });
    });
  });

  it("desde el detalle, el enlace del menú vuelve al listado", async () => {
    const user = await openProduct();
    await screen.findByRole("button", { name: "Presentaciones" });

    await user.click(screen.getByRole("link", { name: "Productos" }));

    // El listado de vuelta: la fila con su botón "Abrir", y sin las pestañas
    // del detalle.
    expect(await screen.findByRole("button", { name: /^Ver / })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Presentaciones" })).not.toBeInTheDocument();
  });

  it("una pestaña inventada en la URL no rompe la pantalla", async () => {
    useAuthStore.getState().setAuth("jwt", demoUser(["products:read"]));
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ["/catalog/products?open=prod-1&tab=inventada"],
      }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    // Cae en "info", que es la pestaña por defecto, en vez de reventar.
    expect(await screen.findByRole("button", { name: "Presentaciones" })).toBeInTheDocument();
  });
});

/**
 * ── LOS DOS CÓDIGOS EN EL ALTA (2026-08-24, decisión de Carlos) ────────────
 *
 * Regla: se exige AL MENOS UNO de los dos códigos.
 *
 * · Producto CON código de barras y sin interno → el interno se completa solo
 *   con el de barras. Adoptar el código mundial como interno es lo que hace
 *   medio comercio, y el interno es obligatorio (identifica en el catálogo).
 * · Producto SIN código de barras → el de barras queda VACÍO, nunca se copia
 *   el interno hacia allá: el código de barras describe una realidad FÍSICA
 *   (lo impreso en el empaque) y rellenarlo inventaría códigos que ningún
 *   escáner va a leer, ensuciando reportes y el índice único del negocio.
 * · El costo vacío viaja como AUSENTE, no como cero: vacío es «sin capturar»
 *   (NULL) y cero es «me cuesta $0» — el promedio ponderado de F5 trataría
 *   ese cero como costo real y envenenaría los márgenes.
 */
describe("Los dos códigos del alta (F2-PROD)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
    mockedProducts.createProduct.mockResolvedValue(PRODUCT);
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  async function abrirAlta() {
    useAuthStore.getState().setAuth("jwt", demoUser(["products:read", "products:manage"]));
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    return user;
  }

  /**
   * Carlos (2026-09-01): la unidad base guarda su CÓDIGO (`unit`, `gr`) y ese
   * código es el que viaja en la plantilla de importación — el desplegable lo
   * enseña entre paréntesis para que nadie tenga que adivinarlo al armar su
   * Excel.
   */
  it("el desplegable de unidad base enseña el código junto al nombre", async () => {
    await abrirAlta();

    const select = screen.getByLabelText(/Unidad base/);
    const etiquetas = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);

    expect(etiquetas).toContain("Pieza (unit)");
    expect(etiquetas).toContain("Gramo (gr)");
    expect(etiquetas).toContain("Mililitro (ml)");
  });

  it("con solo código de barras, el interno se completa solo", async () => {
    const user = await abrirAlta();

    await user.type(screen.getByLabelText(/Código de barras/), "064042603179");
    await user.type(screen.getByLabelText(/Nombre/), "Oatmeal Bars");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      // El segundo argumento es el CONTEXTO que React Query le pasa a la
      // mutación — el gotcha documentado en movements-documents.test.tsx.
      expect(mockedProducts.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ sku: "064042603179", barcode: "064042603179" }),
        expect.anything(),
      );
    });
  });

  it("con solo código interno, el de barras NO se inventa", async () => {
    const user = await abrirAlta();

    await user.type(screen.getByLabelText(/Código interno/), "GRANEL-01");
    await user.type(screen.getByLabelText(/Nombre/), "Arroz a granel");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => {
      expect(mockedProducts.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ sku: "GRANEL-01" }),
        expect.anything(),
      );
    });
    const payload = mockedProducts.createProduct.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.barcode).toBeUndefined();
  });

  it("sin NINGÚN código, Guardar está deshabilitado y la pantalla dice por qué", async () => {
    const user = await abrirAlta();

    await user.type(screen.getByLabelText(/Nombre/), "Sin códigos");

    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    // Un botón muerto sin explicación se lee como pantalla rota.
    expect(screen.getByText(/al menos uno de los dos códigos/i)).toBeInTheDocument();
  });

  it("el costo vacío viaja AUSENTE, no como cero", async () => {
    const user = await abrirAlta();

    await user.type(screen.getByLabelText(/Código interno/), "SIN-COSTO");
    await user.type(screen.getByLabelText(/Nombre/), "Sin costo");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() => expect(mockedProducts.createProduct).toHaveBeenCalled());
    const payload = mockedProducts.createProduct.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.cost).toBeUndefined();
  });
});

/**
 * Fix crítico (2026-08-26): con TRES catálogos de sistema, `find(isSystem)`
 * agarraba el PRIMERO — "Catálogo de Almacenes" por orden alfabético — y el
 * form de producto bindeaba los campos del catálogo equivocado. El form debe
 * resolver por `systemKey === "products"`.
 */
describe("el form de producto usa el catálogo de PRODUCTOS (2026-08-26)", () => {
  it("con los tres catálogos de sistema pide los campos de products", async () => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.02" }],
    });
    mockedProducts.getProduct.mockResolvedValue(PRODUCT);
    // El de Almacenes va PRIMERO, como lo ordena el API (isSystem desc, name asc).
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
    mockedCatalogs.listFields.mockResolvedValue([]);

    useAuthStore.getState().setAuth("jwt", demoUser(["products:read", "products:manage"]));
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo producto" }));

    await waitFor(() => {
      expect(mockedCatalogs.listFields).toHaveBeenCalledWith("cat-prod");
    });
    expect(mockedCatalogs.listFields).not.toHaveBeenCalledWith("cat-wh");
  });
});

describe("Solo-lectura del free tier (F7-WEB-08)", () => {
  it("con el permiso del ROL pero sin plan de escritura, el botón Nuevo producto NO existe", async () => {
    const usuario = demoUser(["products:read", "products:manage"]);
    usuario.subscription = { ...SUBSCRIPTION_PLUS, status: "free", writeAccess: false };
    useAuthStore.getState().setAuth("jwt", usuario);
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Productos" })).toBeInTheDocument();
    // El permiso dice que el ROL puede; el PLAN dice que no — y el plan manda
    // en la UI igual que el 402 manda en el API.
    expect(screen.queryByRole("button", { name: "Nuevo producto" })).not.toBeInTheDocument();
  });
});

/**
 * Carlos (2026-09-02): al dar «Ver», la página se desplazaba hasta el primer
 * campo del formulario y las pestañas (Información, Presentaciones, Stock,
 * Kardex) quedaban fuera de la vista. Lo que entra a la vista es el PANEL,
 * con las pestañas arriba; el cursor puede caer en el primer campo, pero sin
 * mover la vista.
 */
describe("abrir un producto deja las pestañas a la vista", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.02" }],
    });
    mockedProducts.getProduct.mockResolvedValue(PRODUCT);
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("el scroll va al panel (con las pestañas), no al formulario", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await openProduct();
    const pestañas = await screen.findByRole("navigation", { name: /secciones del producto/i });

    await waitFor(() => expect(scroll).toHaveBeenCalled());
    // El ÚLTIMO desplazamiento es el que manda, y tiene que envolver a las
    // pestañas: un scroll al formulario las deja arriba, fuera de la vista.
    const ultimo = scroll.mock.instances.at(-1) as unknown as Element;
    expect(ultimo.contains(pestañas)).toBe(true);
    expect(scroll.mock.calls.at(-1)?.[0]).toMatchObject({ block: "start" });
  });
});

/**
 * Carlos (2026-09-02): el nombre del producto también abre la ficha, igual
 * que «Ver», con la mano del cursor — y sin cambiarle el estilo al texto.
 */
describe("el nombre del producto abre la ficha", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.02" }],
    });
    mockedProducts.getProduct.mockResolvedValue(PRODUCT);
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("clic en el nombre = clic en «Ver», con cursor de mano y el texto tal cual", async () => {
    useAuthStore.getState().setAuth("jwt", demoUser(["products:read", "products:manage"]));
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    const nombre = await screen.findByRole("button", { name: "Azucar" });
    expect(nombre).toHaveClass("cursor-pointer");
    expect(nombre.className).not.toMatch(/underline|text-primary|font-/);

    await user.click(nombre);

    await waitFor(() => {
      expect((router.state.location.search as { open?: string }).open).toBe("prod-1");
    });
    expect(
      await screen.findByRole("navigation", { name: /secciones del producto/i }),
    ).toBeInTheDocument();
  });
});

/**
 * F4-TAX-15 — el selector «Impuesto» del alta de producto: se llena del API
 * y ofrece el predeterminado con su nombre; guardar sin tocarlo manda
 * `taxGroupId: null` (el default del negocio); elegir «Exento» manda su id.
 */
describe("el selector «Impuesto» del producto (F4-TAX-15)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedProducts.listProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
    mockedProducts.createProduct.mockResolvedValue(PRODUCT);
    mockedCatalogs.listCatalogs.mockResolvedValue([]);
    mockedCatalogs.listFields.mockResolvedValue([]);
  });

  it("sin tocarlo manda null; con «Exento» manda su id", async () => {
    useAuthStore.getState().setAuth("jwt", demoUser(["products:read", "products:manage"]));
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
    });
    await router.load();
    render(
      <I18nextProvider i18n={createI18n()}>
        <QueryClientProvider client={createQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    const select = await screen.findByLabelText("Impuesto");
    await waitFor(() =>
      expect(Array.from(select.querySelectorAll("option")).map((o) => o.textContent)).toEqual([
        "Predeterminado del negocio (IVA 16%)",
        "IVA 16%",
        "Exento",
      ]),
    );
    await user.type(screen.getByLabelText(/Nombre/), "Paracetamol");
    await user.type(screen.getByLabelText(/Código interno|SKU/i), "PAR-1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mockedProducts.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ taxGroupId: null }),
        expect.anything(),
      ),
    );

    mockedProducts.createProduct.mockClear();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    await user.selectOptions(await screen.findByLabelText("Impuesto"), "tg-ex");
    await user.type(screen.getByLabelText(/Nombre/), "Medicina");
    await user.type(screen.getByLabelText(/Código interno|SKU/i), "MED-1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mockedProducts.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ taxGroupId: "tg-ex" }),
        expect.anything(),
      ),
    );

    // Volver a «Predeterminado» pasa por el selector y tiene que mandar null,
    // no el id del default: el artículo hereda, no se congela.
    mockedProducts.createProduct.mockClear();
    await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
    const otroSelect = await screen.findByLabelText("Impuesto");
    await user.selectOptions(otroSelect, "tg-ex");
    await user.selectOptions(otroSelect, "");
    await user.type(screen.getByLabelText(/Nombre/), "Jarabe");
    await user.type(screen.getByLabelText(/Código interno|SKU/i), "JAR-1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mockedProducts.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ taxGroupId: null }),
        expect.anything(),
      ),
    );
  });
});
