import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { ApiError } from "@/lib/api";
import * as inventoryApi from "@/lib/inventory/api";
import type { StockLotRow } from "@/lib/inventory/kardex-api";
import * as kardexApi from "@/lib/inventory/kardex-api";
import type { DocumentDetail } from "@/lib/inventory/types";
import * as productsApi from "@/lib/products/api";
import { createQueryClient } from "@/lib/query-client";
import * as rbacApi from "@/lib/rbac/api";
import * as warehousesApi from "@/lib/warehouses/api";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildWarehouse } from "@/test/warehouse-fixture";
import { LotCells } from "./lot-cells";
import { LotEditor } from "./lot-editor";

/**
 * La caducidad en pantalla (Carlos, 2026-11-02). Un lote se guardó con
 * 0027-10-01 porque en el campo de fecha basta teclear «27» en el año. El API
 * es la garantía: rechaza un año fuera de 2000–2099 y, en una entrada de
 * mercancía, una fecha ya pasada. La pantalla dice ESE rechazo donde se
 * tecleó, y su calendario ofrece solo lo que el API acepta.
 */
vi.mock("@/lib/inventory/api", () => ({
  getDocument: vi.fn(),
  updateDocumentHeader: vi.fn(),
  updateDocumentLine: vi.fn(),
  removeDocumentLine: vi.fn(),
  confirmDocument: vi.fn(),
  cancelDocument: vi.fn(),
  printDocumentPdf: vi.fn(),
  downloadDocumentPdf: vi.fn(),
  downloadDocumentSpreadsheet: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  addDocumentLine: vi.fn(),
  importDocumentLines: vi.fn(),
}));
vi.mock("@/lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));
vi.mock("@/lib/products/api", () => ({ listProducts: vi.fn() }));
vi.mock("@/lib/rbac/api", () => ({ listUsers: vi.fn() }));
vi.mock("@/lib/inventory/kardex-api", () => ({
  getStock: vi.fn(),
  getKardex: vi.fn(),
  getInTransit: vi.fn(),
  listProductLots: vi.fn(),
  updateLot: vi.fn(),
}));

const mocked = vi.mocked(inventoryApi);
const mockedKardex = vi.mocked(kardexApi);

/** Hoy con el corte UTC de la caducidad, calculado aparte del código que se prueba. */
const hoyUtc = () => new Date().toISOString().slice(0, 10);

const detalleConLote = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: "doc-1",
  folio: "ENT-000042",
  type: "entry",
  status: "draft",
  warehouse: { id: "w1", name: "Central" },
  reasonCode: "adjustment",
  reference: null,
  reasonNote: "Sobrante",
  authorizedBy: null,
  linkedWarehouseId: null,
  transferId: null,
  source: null,
  lineCount: 1,
  createdAt: "2026-08-18T19:42:00.000Z",
  createdBy: { id: "u1", firstName: "Ana", lastName: "Pérez" },
  confirmedAt: null,
  canceledAt: null,
  rows: [
    {
      id: "line-1",
      lineNo: 1,
      productId: "p1",
      sku: "MAT-30",
      presentationId: null,
      quantityInput: "10",
      quantityBase: "10",
      unitCost: null,
      unitCostNet: null,
      lotCode: "M-27",
      expiresAt: null,
      location: null,
      newLot: true,
      lotPlan: null,
      available: "0",
      stockBefore: "0",
      stockAfter: "10",
      errors: [],
    },
  ],
  products: [
    {
      id: "p1",
      sku: "MAT-30",
      name: "Materna c/30 tabletas",
      baseUnit: "unit",
      isComposite: false,
      tracksLots: true,
      location: null,
      availableUnits: null,
      presentations: [],
    },
  ],
  summary: { lines: 1, products: 1, newLots: 1, errors: 0 },
  ...overrides,
});

const conProveedores = (ui: React.ReactNode) =>
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>
    </I18nextProvider>,
  );

async function renderDocumento(detalle: DocumentDetail) {
  mocked.getDocument.mockResolvedValue(detalle);
  useAuthStore
    .getState()
    .setAuth("jwt-demo", buildAuthUser({ permissions: ["inventory:read", "inventory:movement"] }));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/movements/documents/doc-1"] }),
  });
  await router.load();
  conProveedores(<RouterProvider router={router} />);
  await screen.findByText("MAT-30");
  return screen.getByLabelText("Caducidad") as HTMLInputElement;
}

beforeEach(() => {
  for (const fn of [...Object.values(mocked), ...Object.values(mockedKardex)]) {
    if (typeof fn === "function" && "mockReset" in fn) {
      (fn as { mockReset: () => void }).mockReset();
    }
  }
  vi.mocked(warehousesApi.listWarehouses).mockResolvedValue([buildWarehouse()]);
  vi.mocked(productsApi.listProducts).mockResolvedValue({
    total: 0,
    page: 1,
    pageSize: 20,
    items: [],
  });
  vi.mocked(rbacApi.listUsers).mockResolvedValue([]);
  mockedKardex.listProductLots.mockResolvedValue([]);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("la caducidad de una entrada", () => {
  it("si el API rechaza la caducidad al guardar, la fila dice su mensaje", async () => {
    const rechazo: ApiError = {
      statusCode: 400,
      error: "Bad Request",
      code: "inventory.expiry_year_out_of_range",
      message: "La caducidad 0027-10-01 no es válida: revisa el año.",
    };
    mocked.updateDocumentLine.mockRejectedValue(rechazo);
    const caducidad = await renderDocumento(detalleConLote());

    fireEvent.change(caducidad, { target: { value: "0027-10-01" } });

    expect(
      await screen.findByText(/La caducidad 0027-10-01 no es válida: revisa el año\./),
    ).toBeInTheDocument();
    expect(mocked.updateDocumentLine).toHaveBeenCalledWith(
      "doc-1",
      "line-1",
      expect.objectContaining({ expiresAt: "0027-10-01" }),
    );
    expect(caducidad).toHaveAttribute("aria-invalid", "true");
  });

  it("el calendario de una entrada de mercancía va de hoy a 2099", async () => {
    const caducidad = await renderDocumento(detalleConLote());

    expect(caducidad).toHaveAttribute("min", hoyUtc());
    expect(caducidad).toHaveAttribute("max", "2099-12-31");
  });

  it("la recepción de un traspaso no se corta en hoy: puede traer un lote ya caducado", async () => {
    const caducidad = await renderDocumento(detalleConLote({ reasonCode: "transfer" }));

    expect(caducidad).toHaveAttribute("min", "2000-01-01");
    expect(caducidad).toHaveAttribute("max", "2099-12-31");
  });
});

describe("la caducidad de una compra o una recepción", () => {
  it("el calendario va de hoy a 2099", () => {
    conProveedores(
      <table>
        <tbody>
          <tr>
            <LotCells
              productId="p1"
              controlaLote
              lotCode="M-27"
              expiresAt=""
              editable
              onLotCode={() => {}}
              onExpiresAt={() => {}}
              lotLabel="Lote"
              expiresLabel="Caducidad"
            />
          </tr>
        </tbody>
      </table>,
    );

    const caducidad = screen.getByLabelText("Caducidad");
    expect(caducidad).toHaveAttribute("min", hoyUtc());
    expect(caducidad).toHaveAttribute("max", "2099-12-31");
  });
});

describe("«Editar lote»", () => {
  const lote: StockLotRow = {
    lotId: "lot-1",
    lotCode: "M-27",
    expiresAt: "0027-10-01T00:00:00.000Z",
    location: "",
    quantity: "4",
    expired: true,
    expiringSoon: false,
  };

  it("el calendario va de 2000 a 2099, sin tope en hoy: corrige un lote que ya caducó", () => {
    conProveedores(<LotEditor productId="p1" lot={lote} onClose={() => {}} />);

    const caducidad = screen.getByLabelText("Caducidad");
    expect(caducidad).toHaveAttribute("min", "2000-01-01");
    expect(caducidad).toHaveAttribute("max", "2099-12-31");
  });

  it("si el API rechaza el año, el editor dice su mensaje", async () => {
    mockedKardex.updateLot.mockRejectedValue({
      statusCode: 400,
      error: "Bad Request",
      code: "inventory.expiry_year_out_of_range",
      message: "La caducidad 0027-10-01 no es válida: revisa el año.",
    } satisfies ApiError);
    conProveedores(<LotEditor productId="p1" lot={lote} onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Caducidad"), { target: { value: "0027-11-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    // Cambiar la fecha reordena FEFO: se confirma en el diálogo.
    fireEvent.click(await screen.findByRole("button", { name: "Cambiar la caducidad" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "La caducidad 0027-10-01 no es válida: revisa el año.",
      ),
    );
  });
});
