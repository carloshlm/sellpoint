import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as inventoryApi from "@/lib/inventory/api";
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
 * F9-PURCH-12 — el puente hacia la entrada de inventario.
 *
 * Tres reglas que se fijan acá: solo sobre una compra CONFIRMADA (un borrador
 * todavía puede cambiar de líneas), solo con `purchases:manage` **Y**
 * `inventory:movement` (Compras no es un camino lateral para acuñar entradas),
 * y si la entrada ya existe el botón no la duplica: la CONTINÚA.
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
  listPresentations: vi.fn(),
}));
// La entrada a la que se navega no es lo que se prueba: basta con que exista.
vi.mock("@/lib/inventory/api", async (original) => ({
  ...(await original<typeof inventoryApi>()),
  getDocument: vi.fn(),
}));
const mocked = vi.mocked(purchasesApi);
const mockedProveedores = vi.mocked(suppliersApi);
const mockedProductos = vi.mocked(productsApi);
const mockedInventario = vi.mocked(inventoryApi);

const COMPLETO = ["purchases:read", "purchases:manage", "inventory:movement"];

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

beforeEach(() => {
  mocked.getPurchase.mockResolvedValue(buildPurchase());
  mocked.createEntryDraft.mockResolvedValue({ id: "d9", folio: "ENT-000012", status: "draft" });
  mockedProveedores.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  mockedProductos.listProducts.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });
  mockedProductos.listPresentations.mockResolvedValue([]);
  mockedInventario.getDocument.mockRejectedValue(new Error("la entrada no es el sujeto"));
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Compras — el puente a la entrada (F9-PURCH-12)", () => {
  it("pide la entrada y navega a su borrador", async () => {
    const router = await renderFicha(COMPLETO);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Ingresar al inventario" }));

    await waitFor(() => expect(mocked.createEntryDraft).toHaveBeenCalledWith("p1"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/movements/documents/d9"));
  });

  it("si la entrada ya existe, la CONTINÚA con su folio a la vista", async () => {
    mocked.getPurchase.mockResolvedValue(
      buildPurchase({ entry: { id: "d9", folio: "ENT-000012", status: "draft" } }),
    );
    await renderFicha(COMPLETO);

    const continuar = screen.getByTestId("continue-entry");
    expect(continuar).toHaveTextContent("ENT-000012");
    expect(
      screen.queryByRole("button", { name: "Ingresar al inventario" }),
    ).not.toBeInTheDocument();
  });

  it("con la mercancía ya dentro no hay botón, hay constancia", async () => {
    mocked.getPurchase.mockResolvedValue(
      buildPurchase({ entry: { id: "d9", folio: "ENT-000012", status: "confirmed" } }),
    );
    await renderFicha(COMPLETO);

    expect(screen.getByText(/ya entró con ENT-000012/i)).toBeInTheDocument();
    expect(screen.queryByTestId("continue-entry")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ingresar al inventario" }),
    ).not.toBeInTheDocument();
  });

  it("sin `inventory:movement`, y sobre un borrador, el botón no existe", async () => {
    await renderFicha(["purchases:read", "purchases:manage"]);
    expect(
      screen.queryByRole("button", { name: "Ingresar al inventario" }),
    ).not.toBeInTheDocument();
    // Desmontar: el primer árbol lee los permisos del MISMO store, así que un
    // segundo `setAuth` lo repinta con su compra confirmada y el botón volvería.
    cleanup();
    useAuthStore.getState().clearAuth();

    mocked.getPurchase.mockResolvedValue(buildPurchase({ status: "draft", confirmedAt: null }));
    await renderFicha(COMPLETO);
    expect(
      screen.queryByRole("button", { name: "Ingresar al inventario" }),
    ).not.toBeInTheDocument();
  });
});
