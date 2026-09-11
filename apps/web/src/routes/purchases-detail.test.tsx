import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as kardexApi from "@/lib/inventory/kardex-api";
import * as productsApi from "@/lib/products/api";
import * as purchasesApi from "@/lib/purchases/api";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildPurchase } from "@/test/purchase-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-PURCH-11 — la ficha de la compra. Lo que esta prueba fija es la decisión
 * de Carlos: **el descuadre avisa y NO bloquea**. Ajustar las líneas para que
 * cuadren con el papel pisaría el costo del catálogo con un número inventado,
 * así que la compra se confirma igual y el aviso queda escrito.
 */
vi.mock("@/lib/purchases/api", () => ({
  listPurchases: vi.fn(),
  getPurchase: vi.fn(),
  createPurchase: vi.fn(),
  updatePurchase: vi.fn(),
  updateReception: vi.fn(),
  replacePurchaseLines: vi.fn(),
  replacePurchaseCharges: vi.fn(),
  confirmPurchase: vi.fn(),
  cancelPurchase: vi.fn(),
  createEntryDraft: vi.fn(),
  printPurchase: vi.fn(),
}));
vi.mock("@/lib/suppliers/api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
vi.mock("@/lib/products/api", async (original) => ({
  ...(await original<typeof productsApi>()),
  listProducts: vi.fn(),
  getProduct: vi.fn(),
}));
// El stock del producto: de ahí sale la caducidad de un lote que YA existe.
vi.mock("@/lib/inventory/kardex-api", async (original) => ({
  ...(await original<typeof kardexApi>()),
  getStock: vi.fn(),
}));
const mockedStock = vi.mocked(kardexApi.getStock);
const mocked = vi.mocked(purchasesApi);
const mockedProveedores = vi.mocked(suppliersApi);
const mockedProductos = vi.mocked(productsApi);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({
    permissions,
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["purchases"] },
  });

async function renderFicha(permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/purchases/p1"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByTestId("purchase-detail");
  return router;
}

const GESTOR = ["purchases:read", "purchases:manage"];

beforeEach(() => {
  mocked.getPurchase.mockResolvedValue(buildPurchase({ status: "draft", confirmedAt: null }));
  mocked.confirmPurchase.mockImplementation(async () => buildPurchase());
  mocked.updatePurchase.mockImplementation(async () =>
    buildPurchase({ status: "draft", confirmedAt: null }),
  );
  mocked.cancelPurchase.mockImplementation(async () =>
    buildPurchase({ status: "canceled", canceledAt: "2026-09-11T19:00:00.000Z" }),
  );
  mockedProveedores.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  mockedProductos.listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  mockedStock.mockResolvedValue({
    isComposite: false,
    total: "40",
    stockMin: "0",
    belowMin: false,
    baseUnit: "pieza",
    rows: [
      {
        warehouseId: "w1",
        name: "Central",
        quantity: "40",
        updatedAt: null,
        lots: [
          {
            lotId: "lot-1",
            lotCode: "STM01",
            expiresAt: "2027-03-31T00:00:00.000Z",
            location: "",
            quantity: "40",
            expired: false,
            expiringSoon: false,
          },
        ],
      },
    ],
  });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Compras — la ficha (F9-PURCH-11)", () => {
  it("la cabecera vive en una tarjeta y muestra los totales del papel", async () => {
    await renderFicha(GESTOR);
    // Skill `sellpoint-forms`: la captura va dentro de una <Card>.
    expect(
      screen.getByLabelText("Fecha de la factura").closest('[data-slot="card"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("purchase-total")).toHaveTextContent("$1,160.00");
    expect(screen.queryByTestId("purchase-mismatch")).not.toBeInTheDocument();
  });

  it("un total declarado distinto avisa y NO deshabilita «Confirmar compra»", async () => {
    mocked.getPurchase.mockResolvedValue(
      buildPurchase({
        status: "draft",
        confirmedAt: null,
        declaredTotal: "1200",
        mismatch: true,
        difference: "40",
      }),
    );
    await renderFicha(GESTOR);

    const aviso = screen.getByTestId("purchase-mismatch");
    expect(aviso).toHaveAttribute("role", "alert");
    expect(aviso).toHaveTextContent("$40.00");
    const confirmar = screen.getByRole("button", { name: "Confirmar compra" });
    expect(confirmar).toBeEnabled();

    const user = userEvent.setup();
    await user.click(confirmar);
    const dialogo = await screen.findByTestId("confirm-purchase");
    await user.click(within(dialogo).getByRole("button", { name: "Confirmar compra" }));
    await waitFor(() => expect(mocked.confirmPurchase).toHaveBeenCalledWith("p1"));
  });

  it("dos campos tecleados seguidos viajan JUNTOS: ninguno se pierde", async () => {
    await renderFicha(GESTOR);
    const user = userEvent.setup();

    // Lo cazó el navegador: con un `input` suelto por campo, el segundo cambio
    // pisaba el temporizador del primero y el total declarado se perdía.
    const declarado = screen.getByLabelText("Total que dice la factura");
    const factura = screen.getByLabelText("Factura del proveedor");
    await user.clear(declarado);
    await user.type(declarado, "1200");
    await user.clear(factura);
    await user.type(factura, "A-4472");

    await waitFor(() => expect(mocked.updatePurchase).toHaveBeenCalledTimes(1));
    expect(mocked.updatePurchase).toHaveBeenCalledWith("p1", {
      declaredTotal: 1200,
      supplierInvoice: "A-4472",
    });
  });

  it("una compra confirmada solo deja anotar recepción, factura y notas", async () => {
    mocked.getPurchase.mockResolvedValue(buildPurchase());
    await renderFicha(GESTOR);

    expect(screen.getByLabelText("Fecha de la factura")).toBeDisabled();
    expect(screen.getByLabelText("Total que dice la factura")).toBeDisabled();
    expect(screen.getByLabelText("Fecha de recepción")).toBeEnabled();
    expect(screen.getByLabelText("Factura del proveedor")).toBeEnabled();
    expect(screen.getByLabelText("Notas")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Confirmar compra" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Imprimir" })).toBeInTheDocument();
  });

  it("un producto por lote sin lote avisa, y la compra se confirma igual", async () => {
    const base = buildPurchase({ status: "draft", confirmedAt: null });
    mocked.getPurchase.mockResolvedValue({
      ...base,
      products: [{ ...(base.products[0] as (typeof base.products)[0]), tracksLots: true }],
    });
    await renderFicha(GESTOR);

    expect(screen.getByText(/se controla por lote/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar compra" })).toBeEnabled();

    // Mismas reglas que Entradas (Carlos, 2026-09-11): el lote se normaliza a
    // MAYÚSCULAS al teclear, y si ya existe, su caducidad se pone sola.
    const user = userEvent.setup();
    const lote = screen.getByLabelText("Lote");
    await user.type(lote, "st m 01");
    expect(lote).toHaveValue("STM01");
    await waitFor(() => expect(screen.getByLabelText("Caducidad")).toHaveValue("2027-03-31"));
    await waitFor(() => expect(mockedStock).toHaveBeenCalledWith("prod-1"));
  });

  it("un producto que NO se controla por lote no ofrece lote ni caducidad", async () => {
    // El fixture nace con `tracksLots: false`. Pedir el lote ahí es pedir
    // algo que la entrada de inventario va a rechazar al confirmar.
    await renderFicha(GESTOR);
    expect(screen.queryByLabelText("Lote")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Caducidad")).not.toBeInTheDocument();
    expect(screen.queryByText(/se controla por lote/i)).not.toBeInTheDocument();
    expect(mockedStock).not.toHaveBeenCalled();
  });

  it("anular pide el motivo antes de dejar anular", async () => {
    await renderFicha([...GESTOR, "purchases:cancel"]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Anular compra" }));

    const dialogo = await screen.findByTestId("cancel-purchase");
    const anular = within(dialogo).getByRole("button", { name: "Anular compra" });
    // El motivo es obligatorio en el API (mínimo 3): se dice ANTES del clic.
    expect(anular).toBeDisabled();

    await user.type(screen.getByLabelText(/motivo/i), "pedido duplicado");
    expect(anular).toBeEnabled();
    await user.click(anular);
    await waitFor(() =>
      expect(mocked.cancelPurchase).toHaveBeenCalledWith("p1", "pedido duplicado"),
    );
  });
});
