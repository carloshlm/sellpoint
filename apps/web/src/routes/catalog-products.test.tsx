import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
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

const mockedProducts = vi.mocked(productsApi);
const mockedCatalogs = vi.mocked(catalogsApi);

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

const PRODUCT: productsApi.ProductDetail = {
  id: "prod-1",
  sku: "AZUCAR1GR001",
  name: "Azucar",
  baseUnit: "gr",
  isComposite: false,
  isActive: true,
  attributes: {},
  stockMin: "0",
  presentations: [],
};

async function openProduct() {
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
  await user.click(await screen.findByRole("button", { name: "Abrir" }));
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

    await user.click(await screen.findByRole("button", { name: "Quitar" }));

    expect(await screen.findByTestId("remove-product-dialog")).toHaveTextContent("Azucar");
    expect(mockedProducts.deleteProduct).not.toHaveBeenCalled();
  });

  it("recién al confirmar se borra", async () => {
    mockedProducts.deleteProduct.mockResolvedValue(undefined);
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Quitar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar producto" }));

    await waitFor(() => expect(mockedProducts.deleteProduct).toHaveBeenCalled());
    expect(mockedProducts.deleteProduct.mock.calls[0]?.[0]).toBe("prod-1");
  });

  it("cancelar cierra el diálogo y no borra nada", async () => {
    const user = await openProduct();

    await user.click(await screen.findByRole("button", { name: "Quitar" }));
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

    await user.click(await screen.findByRole("button", { name: "Quitar" }));
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
    await user.click(await screen.findByRole("button", { name: "Abrir" }));

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
    expect(await screen.findByRole("button", { name: "Abrir" })).toBeInTheDocument();
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
