import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as productsApi from "@/lib/products/api";
import * as ordersApi from "@/lib/purchase-orders/api";
import * as purchasesApi from "@/lib/purchases/api";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildPurchase } from "@/test/purchase-fixture";
import { buildPurchaseOrder } from "@/test/purchase-order-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F9-PO-12/13 — la ficha de la orden: la cabecera en tarjeta con el
 * autoguardado ACUMULADO (dos campos, un PATCH), emitida deja solo lo que no
 * mueve dinero, «Cerrar orden» dice cuántas líneas quedan cortas, y
 * «Registrar compra de lo recibido» manda las recepciones marcadas y navega
 * a la compra.
 */
vi.mock("@/lib/purchase-orders/api", () => ({
  listPurchaseOrders: vi.fn(),
  getPurchaseOrder: vi.fn(),
  createPurchaseOrder: vi.fn(),
  updatePurchaseOrder: vi.fn(),
  replacePurchaseOrderLines: vi.fn(),
  issuePurchaseOrder: vi.fn(),
  closePurchaseOrder: vi.fn(),
  closePurchaseOrderLineShort: vi.fn(),
  cancelPurchaseOrder: vi.fn(),
  printPurchaseOrder: vi.fn(),
  listPurchaseReceipts: vi.fn(),
  getPurchaseReceipt: vi.fn(),
  createPurchaseReceipt: vi.fn(),
  updatePurchaseReceipt: vi.fn(),
  replacePurchaseReceiptLines: vi.fn(),
  confirmPurchaseReceipt: vi.fn(),
  cancelPurchaseReceipt: vi.fn(),
  createPurchaseFromReceipts: vi.fn(),
}));
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
const mocked = vi.mocked(ordersApi);
const mockedCompras = vi.mocked(purchasesApi);
const mockedProveedores = vi.mocked(suppliersApi);
const mockedProductos = vi.mocked(productsApi);

const GESTOR = ["purchases:read", "purchases:manage"];
const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({
    permissions,
    tenant: buildTenantBlock({ usesPurchaseOrders: true }),
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["purchases"] },
  });

async function renderFicha(permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/purchase-orders/po1"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByTestId("purchase-order-detail");
  return router;
}

beforeEach(() => {
  mocked.getPurchaseOrder.mockResolvedValue(buildPurchaseOrder());
  mocked.updatePurchaseOrder.mockImplementation(async () => buildPurchaseOrder());
  mocked.closePurchaseOrder.mockImplementation(async () =>
    buildPurchaseOrder({ status: "closed" }),
  );
  mocked.replacePurchaseOrderLines.mockImplementation(async () =>
    buildPurchaseOrder({ status: "draft", issuedAt: null }),
  );
  mocked.issuePurchaseOrder.mockImplementation(async () => buildPurchaseOrder());
  mockedProductos.getProduct.mockResolvedValue({
    id: "prod-2",
    sku: "SKU-2",
    name: "Gasas estériles",
    baseUnit: "pieza",
    isComposite: false,
    isActive: true,
    taxGroupId: null,
    attributes: {},
    stockMin: "0",
    location: null,
    presentations: [
      {
        id: "pres-2",
        productId: "prod-2",
        name: "Paquete ×10",
        factor: "10",
        isPurchasable: true,
        isSellable: true,
        isDefaultSale: false,
        allowFractionalInput: false,
        barcode: null,
        price: null,
        cost: "79",
        isActive: true,
      },
    ],
  });
  mocked.createPurchaseFromReceipts.mockResolvedValue(
    buildPurchase({ id: "c9", folio: "COM-000009" }),
  );
  mockedCompras.getPurchase.mockResolvedValue(buildPurchase({ id: "c9", folio: "COM-000009" }));
  mockedProveedores.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  mockedProductos.listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Órdenes de compra — la ficha (F9-PO-12/13)", () => {
  it("la cabecera vive en una tarjeta; emitida, solo la promesa y las anotaciones siguen vivas", async () => {
    await renderFicha(GESTOR);
    expect(screen.getByLabelText("Fecha del pedido").closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByLabelText("Fecha del pedido")).toBeDisabled();
    expect(screen.getByLabelText("Los costos acordados")).toBeDisabled();
    expect(screen.getByLabelText("Entrega esperada")).toBeEnabled();
    expect(screen.getByLabelText("Referencia del proveedor")).toBeEnabled();
    expect(screen.getByLabelText("Condiciones de pago")).toBeEnabled();
    expect(screen.getByLabelText("Notas")).toBeEnabled();
    // La fecha esperada es la ÚNICA sin tope: puede ser mañana.
    expect(screen.getByLabelText("Entrega esperada")).not.toHaveAttribute("max");
    expect(screen.getByLabelText("Fecha del pedido")).toHaveAttribute("max");
    expect(screen.getByTestId("purchase-order-total")).toHaveTextContent("$13,920.00");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  it("dos campos tecleados seguidos viajan JUNTOS en un solo PATCH (el hook extraído)", async () => {
    await renderFicha(GESTOR);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Referencia del proveedor"), "COT-77");
    await user.type(screen.getByLabelText("Condiciones de pago"), "30 días");
    await waitFor(() => expect(mocked.updatePurchaseOrder).toHaveBeenCalledTimes(1));
    expect(mocked.updatePurchaseOrder).toHaveBeenCalledWith("po1", {
      supplierReference: "COT-77",
      paymentTerms: "30 días",
    });
  });

  it("«Registrar recepción» solo con pendiente; «Cerrar orden» dice cuántas líneas quedan cortas", async () => {
    await renderFicha(GESTOR);
    expect(screen.getByRole("button", { name: "Registrar recepción" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cerrar orden" }));
    const dialogo = await screen.findByTestId("close-order");
    expect(dialogo).toHaveTextContent("1 línea quedará corta.");
    await user.click(within(dialogo).getByRole("button", { name: "Cerrar orden" }));
    await waitFor(() => expect(mocked.closePurchaseOrder).toHaveBeenCalledWith("po1"));
  });

  it("recibida completa, no ofrece «Registrar recepción»", async () => {
    const completa = buildPurchaseOrder({ status: "received" });
    completa.lines = [
      {
        ...(completa.lines[0] as (typeof completa.lines)[number]),
        quantityReceived: "100",
        pending: "0",
      },
    ];
    mocked.getPurchaseOrder.mockResolvedValue(completa);
    await renderFicha(GESTOR);
    expect(screen.queryByRole("button", { name: "Registrar recepción" })).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("«Registrar compra de lo recibido» ofrece solo las confirmadas sin factura, manda las marcadas y navega a la compra", async () => {
    mocked.getPurchaseOrder.mockResolvedValue(
      buildPurchaseOrder({
        status: "partially_received",
        receipts: [
          {
            id: "r1",
            folio: "RCP-000001",
            status: "confirmed",
            receivedDate: "2026-09-11",
            packingSlip: "REM-1",
            purchase: null,
          },
          {
            id: "r2",
            folio: "RCP-000002",
            status: "confirmed",
            receivedDate: "2026-09-12",
            packingSlip: null,
            purchase: null,
          },
          {
            id: "r3",
            folio: "RCP-000003",
            status: "confirmed",
            receivedDate: "2026-09-12",
            packingSlip: null,
            purchase: { id: "c1", folio: "COM-000001", status: "confirmed" },
          },
          {
            id: "r4",
            folio: "RCP-000004",
            status: "draft",
            receivedDate: "2026-09-12",
            packingSlip: null,
            purchase: null,
          },
        ],
      }),
    );
    const router = await renderFicha(GESTOR);
    expect(screen.getByTestId("receipt-r3")).toHaveTextContent("Facturada en COM-000001");
    const user = userEvent.setup();
    await user.click(screen.getByTestId("register-purchase"));
    const dialogo = await screen.findByTestId("register-purchase-dialog");
    // Solo r1 y r2: r3 ya está facturada y r4 es un borrador.
    expect(within(dialogo).getAllByRole("checkbox")).toHaveLength(2);
    await user.click(within(dialogo).getByRole("checkbox", { name: "RCP-000002" }));
    await user.click(within(dialogo).getByRole("button", { name: "Crear la compra" }));
    await waitFor(() =>
      expect(mocked.createPurchaseFromReceipts).toHaveBeenCalledWith("po1", ["r1"]),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/purchases/c9"));
  });

  /** Carlos, 2026-09-11: emitir con líneas sin guardar emitía un pedido distinto del que se veía. */
  it("«Emitir orden» guarda las líneas sin guardar ANTES de preguntar, y no pregunta si guardar falla", async () => {
    const borrador = buildPurchaseOrder({ status: "draft", issuedAt: null });
    mocked.getPurchaseOrder.mockResolvedValue(borrador);
    // El servidor devuelve lo GUARDADO: con eso la tabla deja de estar sucia.
    mocked.replacePurchaseOrderLines.mockImplementation(async () => {
      const guardada = {
        ...borrador,
        lines: [
          {
            ...(borrador.lines[0] as (typeof borrador.lines)[number]),
            quantityOrdered: "120",
            pending: "120",
          },
        ],
      };
      // Y un refetch posterior también trae lo guardado (como el servidor real).
      mocked.getPurchaseOrder.mockResolvedValue(guardada);
      return guardada;
    });
    await renderFicha(GESTOR);
    const user = userEvent.setup();
    const cantidad = within(screen.getByTestId("purchase-order-line-0")).getByLabelText("Cantidad");
    await user.clear(cantidad);
    await user.type(cantidad, "120");
    await user.click(screen.getByRole("button", { name: "Emitir orden" }));
    await waitFor(() =>
      expect(mocked.replacePurchaseOrderLines).toHaveBeenCalledWith("po1", [
        expect.objectContaining({ quantity: 120 }),
      ]),
    );
    await screen.findByTestId("issue-order");

    // Sin cambios, no guarda de más.
    mocked.replacePurchaseOrderLines.mockClear();
    await user.click(
      within(screen.getByTestId("issue-order")).getByRole("button", { name: "Cancelar" }),
    );
    await user.click(screen.getByRole("button", { name: "Emitir orden" }));
    await screen.findByTestId("issue-order");
    expect(mocked.replacePurchaseOrderLines).not.toHaveBeenCalled();
  });

  it("al agregar un producto, el costo del catálogo se precarga (el de la presentación comprable)", async () => {
    mocked.getPurchaseOrder.mockResolvedValue(
      buildPurchaseOrder({ status: "draft", issuedAt: null }),
    );
    mockedProductos.listProducts.mockResolvedValue({
      items: [
        {
          id: "prod-2",
          sku: "SKU-2",
          name: "Gasas estériles",
          baseUnit: "pieza",
          isComposite: false,
          isActive: true,
          taxGroupId: null,
          attributes: {},
          price: null,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    await renderFicha(GESTOR);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Buscar producto"), "gas");
    await user.click(await screen.findByTestId("add-product-prod-2"));
    const fila = await screen.findByTestId("purchase-order-line-1");
    expect(within(fila).getByLabelText("Costo acordado")).toHaveValue("79");
  });

  it("sin nada confirmado sin factura, el botón de registrar compra no existe; sin `purchases:cancel` no hay anular", async () => {
    await renderFicha(GESTOR);
    expect(screen.queryByTestId("register-purchase")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Anular orden" })).not.toBeInTheDocument();
  });
});
