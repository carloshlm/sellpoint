import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as ordersApi from "@/lib/purchase-orders/api";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import * as warehousesApi from "@/lib/warehouses/api";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * Carlos (2026-09-13): la orden nueva no tenía campo de almacén. El API
 * respondía «no tienes un almacén asignado: elige en cuál se recibirá la
 * orden» a una pantalla SIN nada que elegir, así que quien no tenía almacén
 * asignado no podía crear una orden. Ahora el asignado viene puesto, y sin
 * asignado se elige.
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
vi.mock("@/lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
  deleteWarehouse: vi.fn(),
}));
const mocked = vi.mocked(ordersApi);
const mockedProveedores = vi.mocked(suppliersApi);
const mockedAlmacenes = vi.mocked(warehousesApi);

const laboratorio: suppliersApi.Supplier = {
  id: "s1",
  code: "PROV-001",
  name: "Laboratorio Pharma",
  taxId: null,
  contactName: null,
  phone: null,
  email: null,
  address: null,
  notes: null,
  attributes: {},
  isActive: true,
  createdAt: "2026-09-10T18:00:00.000Z",
  updatedAt: "2026-09-10T18:00:00.000Z",
};

const almacenes = [
  { id: "w1", code: "ALM-001", name: "Central" },
  { id: "w2", code: "ALM-002", name: "Norte" },
];

async function renderNueva(defaultWarehouseId: string | null) {
  useAuthStore.getState().setAuth(
    "jwt-demo",
    buildAuthUser({
      permissions: ["purchases:read", "purchases:manage"],
      defaultWarehouseId,
      tenant: buildTenantBlock({ usesPurchaseOrders: true }),
      subscription: { ...SUBSCRIPTION_PLUS, modules: ["purchases"] },
    }),
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/purchase-orders/new"] }),
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

/** Elige el proveedor por el buscador, como lo haría la persona. */
async function elegirProveedor(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText("Proveedor"), "lab");
  await user.click(
    (await screen.findByTestId("supplier-option-s1")).querySelector("button") as HTMLElement,
  );
}

beforeEach(() => {
  mockedProveedores.listSuppliers.mockResolvedValue({
    rows: [laboratorio],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  mockedProveedores.getSupplier.mockResolvedValue(laboratorio);
  mockedAlmacenes.listWarehouses.mockResolvedValue(almacenes as never);
  // Nunca resuelve: el test mide lo que se MANDA, no la pantalla de destino.
  mocked.createPurchaseOrder.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Órdenes de compra — alta con sucursal", () => {
  it("con sucursal asignada, el campo viene puesto con ELLA y la orden lo manda", async () => {
    await renderNueva("w2");
    const user = userEvent.setup();

    const almacen = await screen.findByLabelText("Sucursal");
    await waitFor(() => expect(almacen).toHaveValue("w2"));
    // Solo los del alcance: lo que el API aceptará.
    expect(mockedAlmacenes.listWarehouses).toHaveBeenCalledWith({ scoped: true });

    await elegirProveedor(user);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    await waitFor(() =>
      expect(mocked.createPurchaseOrder).toHaveBeenCalledWith(
        expect.objectContaining({ supplierId: "s1", warehouseId: "w2" }),
      ),
    );
  });

  it("sin sucursal asignada y con varias, pide elegir y NO manda nada hasta que se elige", async () => {
    await renderNueva(null);
    const user = userEvent.setup();

    const almacen = await screen.findByLabelText("Sucursal");
    expect(almacen).toHaveValue("");

    await elegirProveedor(user);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(
      await screen.findByText("Elige la sucursal donde se recibirá la orden."),
    ).toBeInTheDocument();
    expect(mocked.createPurchaseOrder).not.toHaveBeenCalled();

    await user.selectOptions(almacen, "w1");
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    await waitFor(() =>
      expect(mocked.createPurchaseOrder).toHaveBeenCalledWith(
        expect.objectContaining({ warehouseId: "w1" }),
      ),
    );
  });

  it("sin sucursales disponibles lo dice en palabras de compras, no de «movimientos»", async () => {
    mockedAlmacenes.listWarehouses.mockResolvedValue([]);
    await renderNueva(null);
    expect(
      await screen.findByText(
        "No tienes sucursales disponibles. Pídele a un administrador que te dé acceso a una.",
      ),
    ).toBeInTheDocument();
  });
});
