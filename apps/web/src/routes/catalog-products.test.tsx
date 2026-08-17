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
