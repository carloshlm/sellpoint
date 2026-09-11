import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as ordersApi from "@/lib/purchase-orders/api";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildPurchaseOrderRow } from "@/test/purchase-order-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F9-PO-11 — el listado de órdenes: el enlace del menú existe SOLO con el
 * ajuste del negocio (aunque haya módulo y permiso), la fecha esperada
 * vencida se marca, y «Recibidas sin factura» viaja como filtro al API.
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
vi.mock("@/lib/suppliers/api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
const mocked = vi.mocked(ordersApi);
const mockedProveedores = vi.mocked(suppliersApi);

const demoUser = (permissions: string[], usesPurchaseOrders = true): AuthUser =>
  buildAuthUser({
    permissions,
    tenant: buildTenantBlock({ usesPurchaseOrders }),
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["purchases"] },
  });

async function renderEn(path: string, permissions: string[], usesPurchaseOrders = true) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions, usesPurchaseOrders));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

beforeEach(() => {
  mocked.listPurchaseOrders.mockResolvedValue({
    rows: [
      buildPurchaseOrderRow(),
      // Esperada para AYER y todavía abierta: vencida.
      buildPurchaseOrderRow({ id: "po2", folio: "OCO-000002", expectedDate: "2000-01-01" }),
      buildPurchaseOrderRow({
        id: "po3",
        folio: "OCO-000003",
        status: "closed",
        expectedDate: "2000-01-01",
      }),
    ],
    total: 3,
    page: 1,
    pageSize: 20,
    summary: { count: 3, total: "41760", pendingCount: 2 },
  });
  mockedProveedores.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Órdenes de compra — listado (F9-PO-11)", () => {
  it("lista las órdenes, resume el rango y marca la esperada vencida SOLO si sigue abierta", async () => {
    await renderEn("/purchase-orders", ["purchases:read"]);
    const filas = await screen.findAllByTestId(/^purchase-order-po/);
    expect(filas).toHaveLength(3);
    expect(within(filas[0] as HTMLElement).getByText("OCO-000001")).toBeInTheDocument();
    expect(screen.getByTestId("overdue-po2")).toBeInTheDocument();
    // Cerrada con fecha vieja: ya no espera nada, no está vencida.
    expect(screen.queryByTestId("overdue-po3")).not.toBeInTheDocument();
    expect(screen.getByTestId("purchase-orders-summary")).toHaveTextContent("3 órdenes");
    expect(screen.getByTestId("purchase-orders-summary-pending")).toHaveTextContent(
      "2 esperan mercancía",
    );
    // Sin `purchases:manage` no hay alta.
    expect(screen.queryByRole("link", { name: "Nueva orden" })).not.toBeInTheDocument();
  });

  it("«Recibidas sin factura» y «Con pendiente» viajan como filtros al API", async () => {
    await renderEn("/purchase-orders", ["purchases:read", "purchases:manage"]);
    await screen.findByTestId("purchase-order-po1");
    expect(screen.getByRole("link", { name: "Nueva orden" })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Estado"), "pendingInvoice");
    await waitFor(() =>
      expect(mocked.listPurchaseOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ pendingInvoice: true, page: 1 }),
      ),
    );
    await user.selectOptions(screen.getByLabelText("Estado"), "pendingOnly");
    await waitFor(() =>
      expect(mocked.listPurchaseOrders).toHaveBeenLastCalledWith(
        expect.objectContaining({ pendingOnly: true }),
      ),
    );
    expect(mocked.listPurchaseOrders.mock.calls.at(-1)?.[0]).not.toHaveProperty("pendingInvoice");
  });

  it("el enlace «Órdenes de compra» del menú existe solo con el ajuste encendido", async () => {
    await renderEn("/purchase-orders", ["purchases:read"], true);
    await screen.findByTestId("purchase-order-list");
    expect(screen.getByRole("link", { name: "Órdenes de compra" })).toBeInTheDocument();
    cleanup();
    useAuthStore.getState().clearAuth();

    // Módulo y permiso, pero el ajuste apagado: la pantalla existe por URL,
    // el enlace no (leer nunca se apaga; el menú no la promociona).
    await renderEn("/purchase-orders", ["purchases:read"], false);
    await screen.findByTestId("purchase-order-list");
    expect(screen.queryByRole("link", { name: "Órdenes de compra" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Compras" })).toBeInTheDocument();
  });
});
