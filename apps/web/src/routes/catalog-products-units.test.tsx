import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { createI18n } from "../i18n";
import * as catalogsApi from "../lib/catalogs/api";
import * as productsApi from "../lib/products/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F10-BULK-13 — El formulario dice qué unidad elegir (Carlos, 2026-11-25).
 *
 * La unidad base de un producto a granel es la unidad del PRECIO: el queso va
 * en kilogramos, con su precio por kilo, y los gramos se escriben al vender o
 * al dar entrada. Un precio por gramo solo cabe en centavos ($0.185 no entra
 * en dos decimales), así que elegir una unidad chica con precio avisa, sin
 * bloquear el guardado.
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
  lookupBarcode: vi.fn(),
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
    groups: [],
  }),
  updateTaxSettings: vi.fn(),
  deleteTaxGroup: vi.fn(),
}));

const mockedProducts = vi.mocked(productsApi);
const mockedCatalogs = vi.mocked(catalogsApi);

const BASE_UNIT_HINT =
  "Elige la unidad en la que pones el precio. El queso va en kilogramos: los gramos los escribes al vender o al dar entrada.";

const GRAM_WARNING =
  "Si lo vendes por kilogramo, elige Kilogramo: un precio por gramo solo admite centavos.";

const PRODUCT: productsApi.ProductDetail = {
  id: "prod-1",
  sku: "QUESO-OAX",
  name: "Queso Oaxaca",
  baseUnit: "gr",
  isComposite: false,
  isActive: true,
  attributes: {},
  taxGroupId: null,
  stockMin: "0",
  location: null,
  presentations: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.getState().clearAuth();
  mockedProducts.listProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  mockedProducts.createProduct.mockResolvedValue(PRODUCT);
  mockedProducts.updateProduct.mockResolvedValue(PRODUCT);
  mockedProducts.getProduct.mockResolvedValue(PRODUCT);
  mockedCatalogs.listCatalogs.mockResolvedValue([]);
  mockedCatalogs.listFields.mockResolvedValue([]);
});

async function renderProducts(language: "es" | "en" = "es") {
  useAuthStore.getState().setAuth(
    "jwt",
    buildAuthUser({
      permissions: ["products:read", "products:manage"],
      tenant: buildTenantBlock({ costTaxMode: "excluded", taxMode: "included" }),
    }),
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/products"] }),
  });
  await router.load();
  const i18n = createI18n();
  await i18n.changeLanguage(language);
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return userEvent.setup();
}

async function abrirAlta() {
  const user = await renderProducts();
  await user.click(await screen.findByRole("button", { name: "Nuevo producto" }));
  return user;
}

const unidadBase = () => screen.getByLabelText("Unidad base");
const precio = () => screen.getByLabelText(/^Precio de venta/);

describe("la ayuda de «Unidad base» (F10-BULK-13)", () => {
  it("bajo «Unidad base» dice que se elige la unidad del precio", async () => {
    await abrirAlta();

    // Es la descripción del desplegable, no un texto suelto: el lector de
    // pantalla la lee al llegar al campo.
    expect(unidadBase()).toHaveAccessibleDescription(BASE_UNIT_HINT);
  });
});

describe("el aviso al elegir una unidad chica con precio (F10-BULK-13)", () => {
  it("con gramo y precio aparece el aviso que nombra Kilogramo", async () => {
    const user = await abrirAlta();

    await user.selectOptions(unidadBase(), "gr");
    await user.type(precio(), "0.18");

    // `status` y no `alert`: avisa sin interrumpir, porque no es un error.
    expect(screen.getByText(GRAM_WARNING)).toHaveAttribute("role", "status");
  });

  it("el orden no importa: el precio primero y la unidad después también avisa", async () => {
    const user = await abrirAlta();

    await user.type(precio(), "0.18");
    expect(screen.queryByText(GRAM_WARNING)).not.toBeInTheDocument();
    await user.selectOptions(unidadBase(), "gr");

    expect(screen.getByText(GRAM_WARNING)).toBeInTheDocument();
  });

  it.each([
    ["ml", "Si lo vendes por litro, elige Litro: un precio por mililitro solo admite centavos."],
    ["cm", "Si lo vendes por metro, elige Metro: un precio por centímetro solo admite centavos."],
    ["oz", "Si lo vendes por libra, elige Libra: un precio por onza solo admite centavos."],
    ["in", "Si lo vendes por pie, elige Pie: un precio por pulgada solo admite centavos."],
  ])("con %s nombra la unidad mayor de su familia", async (unit, aviso) => {
    const user = await abrirAlta();

    await user.selectOptions(unidadBase(), unit);
    await user.type(precio(), "3");

    expect(screen.getByText(aviso)).toBeInTheDocument();
  });

  it.each([["kg"], ["l"], ["unit"]])("con %s y precio no hay aviso", async (unit) => {
    const user = await abrirAlta();

    await user.selectOptions(unidadBase(), unit);
    await user.type(precio(), "185");

    expect(screen.queryByText(/solo admite centavos/)).not.toBeInTheDocument();
  });

  it("con gramo sin precio no hay aviso", async () => {
    const user = await abrirAlta();

    await user.selectOptions(unidadBase(), "gr");

    expect(screen.queryByText(GRAM_WARNING)).not.toBeInTheDocument();
  });

  it("al borrar el precio, el aviso se va", async () => {
    const user = await abrirAlta();

    await user.selectOptions(unidadBase(), "gr");
    await user.type(precio(), "0.18");
    await user.clear(precio());

    expect(screen.queryByText(GRAM_WARNING)).not.toBeInTheDocument();
  });

  it("el aviso no bloquea: con gramo y precio, Guardar sigue mandando la unidad elegida", async () => {
    const user = await abrirAlta();

    await user.type(screen.getByLabelText(/Código interno/), "QUESO-OAX");
    await user.type(screen.getByLabelText(/^Nombre/), "Queso Oaxaca");
    await user.selectOptions(unidadBase(), "gr");
    await user.type(precio(), "0.18");
    expect(screen.getByText(GRAM_WARNING)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(mockedProducts.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ baseUnit: "gr", price: 0.18 }),
        expect.anything(),
      ),
    );
  });

  it("en inglés nombra las unidades en inglés", async () => {
    const user = await renderProducts("en");
    await user.click(await screen.findByRole("button", { name: "New product" }));

    await user.selectOptions(screen.getByLabelText("Base unit"), "gr");
    await user.type(screen.getByLabelText(/^Price/), "0.18");

    expect(
      screen.getByText(
        "If you sell it by the kilogram, choose Kilogram: a price per gram can only hold cents.",
      ),
    ).toBeInTheDocument();
  });

  /**
   * El aviso es para quien ELIGE la unidad. Un producto que ya está en gramos
   * sigue funcionando con su presentación «Kilogramo» (decisión 4 del módulo)
   * y, con historial, su unidad base ya no se puede cambiar: repetirle «elige
   * Kilogramo» cada vez que se abre su ficha sería pedirle algo imposible.
   */
  it("al editar un producto que ya está en gramos no avisa hasta que se cambia la unidad", async () => {
    mockedProducts.listProducts.mockResolvedValue({
      total: 1,
      page: 1,
      pageSize: 20,
      items: [{ ...PRODUCT, price: "0.18" }],
    });
    mockedProducts.getProduct.mockResolvedValue({
      ...PRODUCT,
      presentations: [
        {
          id: "pres-1",
          productId: "prod-1",
          name: "Gramo",
          factor: "1",
          isPurchasable: true,
          isSellable: true,
          isDefaultSale: true,
          allowFractionalInput: true,
          barcode: null,
          price: "0.18",
          cost: null,
          isActive: true,
        },
      ],
    });
    const user = await renderProducts();
    await user.click(await screen.findByRole("button", { name: /^Ver / }));
    await screen.findByRole("button", { name: "Guardar" });

    expect(unidadBase()).toHaveValue("gr");
    expect(screen.queryByText(GRAM_WARNING)).not.toBeInTheDocument();

    await user.selectOptions(unidadBase(), "ml");

    expect(
      screen.getByText(
        "Si lo vendes por litro, elige Litro: un precio por mililitro solo admite centavos.",
      ),
    ).toBeInTheDocument();
  });
});
