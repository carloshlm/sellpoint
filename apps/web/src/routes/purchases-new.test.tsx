import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as purchasesApi from "@/lib/purchases/api";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import * as warehousesApi from "@/lib/warehouses/api";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * Carlos (2026-09-13): la compra nueva no tenía campo de almacén, y quien no
 * tenía almacén asignado recibía «elige a cuál entra la compra» sin nada que
 * elegir. Ahora el asignado viene puesto, y sin asignado se elige.
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
vi.mock("@/lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
  deleteWarehouse: vi.fn(),
}));
const mocked = vi.mocked(purchasesApi);
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
      subscription: { ...SUBSCRIPTION_PLUS, modules: ["purchases"] },
    }),
  );
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/purchases/new"] }),
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
  mocked.createPurchase.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Compras — alta con sucursal", () => {
  it("con sucursal asignada, el campo viene puesto con ELLA y la compra lo manda", async () => {
    await renderNueva("w2");
    const user = userEvent.setup();

    const almacen = await screen.findByLabelText("Sucursal");
    await waitFor(() => expect(almacen).toHaveValue("w2"));
    expect(mockedAlmacenes.listWarehouses).toHaveBeenCalledWith({ scoped: true });

    await elegirProveedor(user);
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    await waitFor(() =>
      expect(mocked.createPurchase).toHaveBeenCalledWith(
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
      await screen.findByText("Elige la sucursal a la que entra la compra."),
    ).toBeInTheDocument();
    expect(mocked.createPurchase).not.toHaveBeenCalled();

    await user.selectOptions(almacen, "w1");
    await user.click(screen.getByRole("button", { name: "Crear borrador" }));
    await waitFor(() =>
      expect(mocked.createPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ warehouseId: "w1" }),
      ),
    );
  });
});
