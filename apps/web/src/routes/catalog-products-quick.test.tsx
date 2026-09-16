import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@/stores/auth.store";
import { useQuickCatalogStore } from "@/stores/quick-catalog.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { createI18n } from "../i18n";
import * as productsApi from "../lib/products/api";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";

/**
 * F10-QUICKCAT — la carga rápida.
 *
 * Lo que se prueba acá es lo que hace que escanear 80 productos sea posible:
 * que ningún escaneo se pierda, que el borrador sobreviva, que sea del dueño
 * correcto y que un rebote del servidor no borre media hora de trabajo.
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
  quickAddProducts: vi.fn(),
}));

// La cámara no existe en jsdom y este componente no es lo que se prueba acá.
vi.mock("@/components/pos/barcode-scanner", () => ({
  BarcodeScanner: () => null,
}));

const mocked = vi.mocked(productsApi);

const desconocido = (code: string): productsApi.BarcodeLookup => ({
  status: "unknown",
  code,
  gtin14: `0${code}`,
  tenant: null,
  global: null,
  contributable: true,
});

const enCatalogoGlobal = (code: string, name: string): productsApi.BarcodeLookup => ({
  status: "global",
  code,
  gtin14: `0${code}`,
  tenant: null,
  global: { name, brand: "Marca", unitSize: "600 ml" },
  contributable: false,
});

const yaEsDelNegocio = (code: string, name: string, price: string): productsApi.BarcodeLookup => ({
  status: "tenant",
  code,
  gtin14: `0${code}`,
  tenant: { productId: "p-1", presentationId: "pr-1", sku: code, name, price },
  global: null,
  contributable: false,
});

const USUARIO = buildAuthUser({
  permissions: ["products:read", "products:manage"],
  tenant: buildTenantBlock({}),
});

async function abrir(user = USUARIO) {
  useAuthStore.getState().setAuth("jwt", user);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/catalog/products/quick"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return userEvent.setup();
}

const escanear = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
  const campo = screen.getByLabelText("Código de barras");
  await user.click(campo);
  await user.type(campo, `${code}{Enter}`);
};

describe("Carga rápida de catálogo (F10-QUICKCAT)", () => {
  beforeEach(() => {
    // `clearAllMocks` NO vacía la cola de `mockResolvedValueOnce`: una prueba
    // que deja uno sin consumir se lo presta a la siguiente, y el síntoma —un
    // nombre de otra prueba— no se parece en nada a la causa.
    vi.resetAllMocks();
    localStorage.clear();
    useQuickCatalogStore.setState({ owner: null, lines: [], storageFailed: false });
    useAuthStore.getState().clearAuth();
    mocked.listProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  });

  it("el catálogo compartido sugiere el nombre y solo queda poner el precio", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();

    await escanear(user, "7501055300013");

    expect(await screen.findByDisplayValue("Refresco 600 ml")).toBeInTheDocument();
    expect(screen.getByText("Nombre sugerido")).toBeInTheDocument();
  });

  it("lo que el negocio ya tiene no se renombra desde acá: el nombre es de solo lectura", async () => {
    mocked.lookupBarcode.mockResolvedValue(
      yaEsDelNegocio("7501055300013", "Como lo llamo yo", "18.50"),
    );
    const user = await abrir();

    await escanear(user, "7501055300013");

    const nombre = await screen.findByDisplayValue("Como lo llamo yo");
    expect(nombre).toHaveAttribute("readonly");
    expect(screen.getByText("Ya lo tienes")).toBeInTheDocument();
    expect(screen.getByDisplayValue("18.50")).toBeInTheDocument();
  });

  it("lo que nadie conoce se captura a mano y avisa que se comparte", async () => {
    mocked.lookupBarcode.mockResolvedValue(desconocido("7509999000013"));
    const user = await abrir();

    await escanear(user, "7509999000013");

    expect(await screen.findByText("Nuevo para todos")).toBeInTheDocument();
    expect(screen.getByText("Se sumará al catálogo compartido")).toBeInTheDocument();
  });

  it("el mismo código dos veces NO duplica la línea", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();

    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");
    await escanear(user, "7501055300013");

    expect(await screen.findByRole("status")).toHaveTextContent("ya está en la lista");
    expect(screen.getAllByDisplayValue("Refresco 600 ml")).toHaveLength(1);
    expect(mocked.lookupBarcode).toHaveBeenCalledTimes(1);
  });

  /**
   * El bug que `pos/cart-search.tsx` ya pagó: dos consultas en vuelo se pisan
   * y una línea se pierde. Con la pistola en la mano, dos escaneos separados
   * por 200 ms son lo normal.
   */
  it("dos escaneos seguidos, sin esperar al primero, dejan DOS líneas", async () => {
    mocked.lookupBarcode
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(enCatalogoGlobal("7501055300013", "Primero")), 30),
          ),
      )
      .mockResolvedValueOnce(enCatalogoGlobal("7509999000006", "Segundo"));
    const user = await abrir();

    await escanear(user, "7501055300013");
    await escanear(user, "7509999000006");

    expect(await screen.findByDisplayValue("Primero")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Segundo")).toBeInTheDocument();
  });

  it("el borrador sobrevive a salir de la pantalla y volver", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    // Como si se hubiera cerrado la pestaña: solo queda lo guardado.
    const guardado = localStorage.getItem("sellpoint.quickCatalog");
    useQuickCatalogStore.setState({ owner: null, lines: [], storageFailed: false });
    expect(guardado).toContain("7501055300013");
  });

  it("el borrador de OTRA cuenta no aparece: se descarta al entrar", async () => {
    useQuickCatalogStore.setState({
      owner: "otro-negocio:otro-usuario",
      lines: [
        {
          code: "7501055300013",
          status: "known",
          name: "Del vecino",
          price: "10",
          brand: null,
          contributable: false,
        },
      ],
      storageFailed: false,
    });

    await abrir();

    await waitFor(() => {
      expect(screen.queryByDisplayValue("Del vecino")).not.toBeInTheDocument();
    });
  });

  it("un rebote del servidor NO vacía el borrador y marca la línea culpable", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    mocked.quickAddProducts.mockRejectedValue({
      statusCode: 422,
      error: "Unprocessable Entity",
      message: "Revisa las líneas marcadas.",
      errors: [
        {
          line: 1,
          itemCode: "7501055300013",
          field: "code",
          message: "Ese código ya está en uso.",
        },
      ],
    });
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");
    await user.type(screen.getByLabelText("Precio de venta"), "18.50");

    await user.click(screen.getByRole("button", { name: /Dar de alta/ }));

    expect(await screen.findByText("Ese código ya está en uso.")).toBeInTheDocument();
    // La media hora de escaneo sigue en pie.
    expect(screen.getByDisplayValue("Refresco 600 ml")).toBeInTheDocument();
  });

  it("al dar de alta se manda en el orden en que se escaneó, no como se ve", async () => {
    mocked.lookupBarcode
      .mockResolvedValueOnce(enCatalogoGlobal("7501055300013", "Primero"))
      .mockResolvedValueOnce(enCatalogoGlobal("7509999000006", "Segundo"));
    mocked.quickAddProducts.mockResolvedValue({ created: 2, updated: 0, contributed: 1 });
    const user = await abrir();

    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Primero");
    await escanear(user, "7509999000006");
    await screen.findByDisplayValue("Segundo");

    const precios = screen.getAllByLabelText("Precio de venta");
    // El segundo escaneo se pinta ARRIBA: su precio es el primero de la tabla.
    await user.type(precios[0] as HTMLElement, "10");
    await user.type(precios[1] as HTMLElement, "20");

    await user.click(screen.getByRole("button", { name: /Dar de alta/ }));

    await waitFor(() => {
      // El segundo argumento es el contexto que react-query le pasa a toda
      // `mutationFn`; lo que se mide es el cuerpo.
      expect(mocked.quickAddProducts).toHaveBeenCalledWith(
        {
          lines: [
            { code: "7501055300013", name: "Primero", price: 20 },
            { code: "7509999000006", name: "Segundo", price: 10 },
          ],
        },
        expect.anything(),
      );
    });
    expect(await screen.findByText(/2 productos nuevos/)).toBeInTheDocument();
  });

  it("una línea sin precio frena el alta y lo dice, sin mandar nada", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    await user.click(screen.getByRole("button", { name: /Dar de alta/ }));

    expect(await screen.findByText("Escribe el precio de venta.")).toBeInTheDocument();
    expect(mocked.quickAddProducts).not.toHaveBeenCalled();
  });

  it("Enter en el precio devuelve el foco al escáner: eso hace viable la ráfaga", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    const precio = screen.getByLabelText("Precio de venta");
    await user.click(precio);
    await user.type(precio, "18.50{Enter}");

    expect(screen.getByLabelText("Código de barras")).toHaveFocus();
  });

  it("quitar una línea la saca del borrador", async () => {
    mocked.lookupBarcode.mockResolvedValue(enCatalogoGlobal("7501055300013", "Refresco 600 ml"));
    const user = await abrir();
    await escanear(user, "7501055300013");
    await screen.findByDisplayValue("Refresco 600 ml");

    await user.click(screen.getByRole("button", { name: /Quitar la línea/ }));

    expect(screen.queryByDisplayValue("Refresco 600 ml")).not.toBeInTheDocument();
  });
});
