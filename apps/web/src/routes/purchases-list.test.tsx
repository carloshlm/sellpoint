import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as purchasesApi from "@/lib/purchases/api";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildPurchaseRow } from "@/test/purchase-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-PURCH-10/13 — el listado de compras: la bandera de descuadre por fila, el
 * resumen del RANGO (no de la página) y el enlace del menú que solo existe con
 * el módulo. El folio busca con debounce: una tecla no es una petición.
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
const mocked = vi.mocked(purchasesApi);
const mockedProveedores = vi.mocked(suppliersApi);

const demoUser = (permissions: string[], modules: string[] = ["purchases"]): AuthUser =>
  buildAuthUser({
    permissions,
    subscription: { ...SUBSCRIPTION_PLUS, modules: modules as never },
  });

const fila = buildPurchaseRow;

async function renderEn(path: string, permissions: string[], modules?: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions, modules));
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
  mocked.listPurchases.mockResolvedValue({
    rows: [
      fila(),
      fila({
        id: "p2",
        folio: "COM-000002",
        status: "draft",
        declaredTotal: "1200",
        mismatch: true,
        difference: "40",
        confirmedAt: null,
      }),
    ],
    total: 2,
    page: 1,
    pageSize: 20,
    summary: { count: 2, total: "2320", mismatchCount: 1 },
  });
  mockedProveedores.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Compras — listado (F9-PURCH-10/13)", () => {
  it("lista las compras y marca la fila que no cuadra con la factura", async () => {
    await renderEn("/purchases", ["purchases:read"]);
    const filas = await screen.findAllByTestId(/^purchase-p/);
    expect(filas).toHaveLength(2);
    expect(within(filas[0] as HTMLElement).getByText("COM-000001")).toBeInTheDocument();
    expect(screen.queryByTestId("mismatch-p1")).not.toBeInTheDocument();
    // La bandera viaja por fila: quien revisa el mes ve cuáles no cuadraban.
    expect(screen.getByTestId("mismatch-p2")).toBeInTheDocument();
    // Sin `purchases:manage` no hay alta.
    expect(screen.queryByRole("link", { name: "Nueva compra" })).not.toBeInTheDocument();
  });

  it("el resumen es del RANGO y el descuadre solo aparece cuando hay", async () => {
    await renderEn("/purchases", ["purchases:read", "purchases:manage"]);
    const resumen = await screen.findByTestId("purchases-summary");
    expect(resumen).toHaveTextContent("2 compras");
    expect(resumen).toHaveTextContent("$2,320.00");
    expect(screen.getByTestId("purchases-summary-mismatch")).toHaveTextContent("1 no cuadra");
    expect(screen.getByRole("link", { name: "Nueva compra" })).toBeInTheDocument();

    mocked.listPurchases.mockResolvedValue({
      rows: [fila()],
      total: 1,
      page: 1,
      pageSize: 20,
      summary: { count: 1, total: "1160", mismatchCount: 0 },
    });
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Estado"), "confirmed");
    await waitFor(() =>
      expect(screen.queryByTestId("purchases-summary-mismatch")).not.toBeInTheDocument(),
    );
  });

  /** Carlos, 2026-09-12: «un estatus para saber que la compra ya fue ingresada al inventario». */
  it("una compra ya ingresada dice «En inventario», y el filtro viaja como status=stocked", async () => {
    mocked.listPurchases.mockResolvedValue({
      rows: [fila({ id: "p3", folio: "COM-000003", status: "stocked" })],
      total: 1,
      page: 1,
      pageSize: 20,
      summary: { count: 1, total: "1160", mismatchCount: 0 },
    });
    await renderEn("/purchases", ["purchases:read"]);
    const filaIngresada = await screen.findByTestId("purchase-p3");
    expect(within(filaIngresada).getByText("En inventario")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Estado"), "stocked");
    await waitFor(() =>
      expect(mocked.listPurchases).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "stocked" }),
      ),
    );
  });

  it("el folio busca con debounce: una sola petición con el término", async () => {
    await renderEn("/purchases", ["purchases:read"]);
    await screen.findByTestId("purchase-p1");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Folio"), "COM-000002");
    await waitFor(() =>
      expect(mocked.listPurchases).toHaveBeenLastCalledWith(
        expect.objectContaining({ folio: "COM-000002", page: 1 }),
      ),
    );
    // Nueve teclas, no nueve peticiones: la inicial más la del término.
    expect(mocked.listPurchases.mock.calls.filter((c) => c[0]?.folio !== undefined)).toHaveLength(
      1,
    );
  });

  it("el enlace «Compras» del menú existe solo con el módulo", async () => {
    await renderEn("/purchases", ["purchases:read"], ["purchases"]);
    await screen.findByTestId("purchase-list");
    expect(screen.getByRole("link", { name: "Compras" })).toBeInTheDocument();
    cleanup();
    useAuthStore.getState().clearAuth();

    await renderEn("/purchases", ["purchases:read"], []);
    await screen.findByTestId("purchase-list");
    // El grupo del menú no se pinta; el título de la pantalla no es un enlace.
    expect(screen.queryByRole("link", { name: "Compras" })).not.toBeInTheDocument();
  });
});
