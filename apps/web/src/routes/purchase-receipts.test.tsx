import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as kardexApi from "@/lib/inventory/kardex-api";
import * as ordersApi from "@/lib/purchase-orders/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildPurchaseReceipt } from "@/test/purchase-order-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F9-PO-13 — la recepción: nace con lo pendiente, el lote se captura con las
 * MISMAS celdas que la compra (mayúsculas, caducidad del registro), el 422
 * del API se ve junto a la tabla, y una facturada no se anula.
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
vi.mock("@/lib/inventory/kardex-api", async (original) => ({
  ...(await original<typeof kardexApi>()),
  listProductLots: vi.fn(),
}));
const mocked = vi.mocked(ordersApi);
const mockedLots = vi.mocked(kardexApi.listProductLots);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({
    permissions,
    tenant: buildTenantBlock({ usesPurchaseOrders: true }),
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["purchases"] },
  });

async function renderRecepcion(permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/purchase-orders/po1/receipts/rcp1"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByTestId("purchase-receipt-detail");
  return router;
}

const GESTOR = ["purchases:read", "purchases:manage", "purchases:cancel"];

beforeEach(() => {
  mocked.getPurchaseReceipt.mockResolvedValue(buildPurchaseReceipt());
  mocked.replacePurchaseReceiptLines.mockImplementation(async () => buildPurchaseReceipt());
  mockedLots.mockResolvedValue([
    {
      id: "lot-1",
      lotCode: "HIST-01",
      expiresAt: "2028-05-31T00:00:00.000Z",
      totalQuantity: "0",
      byWarehouse: [],
    },
  ]);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("Recepción de una orden (F9-PO-13)", () => {
  it("nace con lo pendiente, y el lote se captura como en la compra: mayúsculas y caducidad del registro", async () => {
    await renderRecepcion(GESTOR);
    const fila = screen.getByTestId("receipt-line-0");
    expect(within(fila).getByLabelText("Llegó")).toHaveValue("100");
    expect(fila).toHaveTextContent("100");
    const user = userEvent.setup();
    const lote = within(fila).getByLabelText("Lote");
    await user.type(lote, "hist-01");
    expect(lote).toHaveValue("HIST-01");
    await waitFor(() => expect(within(fila).getByLabelText("Caducidad")).toHaveValue("2028-05-31"));
  });

  it("autoguardar la remisión NO pisa la cantidad tecleada en la tabla (lo cazó el navegador)", async () => {
    mocked.updatePurchaseReceipt.mockImplementation(async () =>
      buildPurchaseReceipt({ packingSlip: "REM-889" }),
    );
    await renderRecepcion(GESTOR);
    const user = userEvent.setup();
    const cantidad = within(screen.getByTestId("receipt-line-0")).getByLabelText("Llegó");
    await user.clear(cantidad);
    await user.type(cantidad, "6");
    await user.type(screen.getByLabelText("Remisión o packing slip"), "REM-889");
    await waitFor(() => expect(mocked.updatePurchaseReceipt).toHaveBeenCalled());
    // La recepción volvió del API con la remisión: la tabla conserva el 6.
    expect(cantidad).toHaveValue("6");
    await user.click(screen.getByRole("button", { name: "Guardar líneas" }));
    await waitFor(() =>
      expect(mocked.replacePurchaseReceiptLines).toHaveBeenCalledWith("po1", "rcp1", [
        expect.objectContaining({ quantity: 6 }),
      ]),
    );
  });

  it("el rebote del API por recibir de más se ve junto a la tabla", async () => {
    mocked.replacePurchaseReceiptLines.mockRejectedValue({
      message:
        "Línea 1: llega más de lo pendiente (100). Recibe hasta lo pendiente y anota el resto en las notas.",
    });
    await renderRecepcion(GESTOR);
    const user = userEvent.setup();
    const cantidad = within(screen.getByTestId("receipt-line-0")).getByLabelText("Llegó");
    await user.clear(cantidad);
    await user.type(cantidad, "170");
    await user.click(screen.getByRole("button", { name: "Guardar líneas" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Línea 1: llega más de lo pendiente",
    );
  });

  /**
   * Carlos, 2026-09-12: el lote tecleado sin «Guardar líneas» se perdía al
   * confirmar y la compra nacía sin él. Confirmar guarda primero lo sucio y
   * después pregunta; y al confirmar, el aviso verde aparece a la vista.
   */
  it("confirmar guarda las líneas sucias ANTES de preguntar, y confirmada muestra el aviso verde", async () => {
    mocked.replacePurchaseReceiptLines.mockImplementation(async (_orderId, _receiptId, lines) => {
      const guardada = buildPurchaseReceipt({
        lines: buildPurchaseReceipt().lines.map((l) => ({
          ...l,
          quantity: String(lines[0]?.quantity ?? l.quantity),
          lotCode: lines[0]?.lotCode ?? l.lotCode,
        })),
      });
      mocked.getPurchaseReceipt.mockResolvedValue(guardada);
      return guardada;
    });
    mocked.confirmPurchaseReceipt.mockImplementation(async () => {
      const confirmada = buildPurchaseReceipt({
        status: "confirmed",
        confirmedAt: "2026-09-12T01:00:00.000Z",
      });
      mocked.getPurchaseReceipt.mockResolvedValue(confirmada);
      return confirmada;
    });
    await renderRecepcion(GESTOR);
    const user = userEvent.setup();
    const fila = screen.getByTestId("receipt-line-0");
    await user.type(within(fila).getByLabelText("Lote"), "st1");
    await user.click(screen.getByRole("button", { name: "Confirmar recepción" }));
    await waitFor(() =>
      expect(mocked.replacePurchaseReceiptLines).toHaveBeenCalledWith("po1", "rcp1", [
        expect.objectContaining({ lotCode: "ST1" }),
      ]),
    );
    const dialogo = await screen.findByTestId("confirm-receipt");
    await user.click(within(dialogo).getByRole("button", { name: "Confirmar recepción" }));
    await waitFor(() => expect(mocked.confirmPurchaseReceipt).toHaveBeenCalledWith("po1", "rcp1"));
    const aviso = await screen.findByTestId("receipt-confirmed");
    expect(aviso).toHaveTextContent("Recepción confirmada");
    expect(aviso).toHaveAttribute("role", "status");
  });

  it("confirmar pide confirmación; una facturada no ofrece anular", async () => {
    await renderRecepcion(GESTOR);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Confirmar recepción" }));
    const dialogo = await screen.findByTestId("confirm-receipt");
    expect(dialogo).toHaveTextContent("La mercancía entra al inventario");
    await user.click(within(dialogo).getByRole("button", { name: "Confirmar recepción" }));
    await waitFor(() => expect(mocked.confirmPurchaseReceipt).toHaveBeenCalledWith("po1", "rcp1"));
    useAuthStore.getState().clearAuth();
  });

  it("facturada: sin «Anular» y con el aviso de en qué compra", async () => {
    mocked.getPurchaseReceipt.mockResolvedValue(
      buildPurchaseReceipt({
        status: "confirmed",
        confirmedAt: "2026-09-11T19:00:00.000Z",
        purchase: { id: "c1", folio: "COM-000001", status: "confirmed" },
      }),
    );
    await renderRecepcion(GESTOR);
    expect(screen.queryByRole("button", { name: "Anular recepción" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("COM-000001");
    expect(screen.queryByLabelText("Llegó")).not.toBeInTheDocument();
  });
});
