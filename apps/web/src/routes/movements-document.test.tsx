import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import * as inventoryApi from "../lib/inventory/api";
import * as kardexApi from "../lib/inventory/kardex-api";
import type { DocumentDetail, DocumentRow } from "../lib/inventory/types";
import * as productsApi from "../lib/products/api";
import { createQueryClient } from "../lib/query-client";
import * as rbacApi from "../lib/rbac/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-DOC-09 — la pantalla del documento.
 *
 * **Una sola pantalla con dos caras.** En `draft` es captura con autoguardado
 * y previa en vivo; en `confirmed` es solo lectura de lo que realmente pasó.
 * Tenerlas separadas obligaría a mantener dos veces la misma tabla y las haría
 * divergir.
 */
vi.mock("../lib/inventory/api", () => ({
  getDocument: vi.fn(),
  updateDocumentHeader: vi.fn(),
  updateDocumentLine: vi.fn(),
  removeDocumentLine: vi.fn(),
  confirmDocument: vi.fn(),
  cancelDocument: vi.fn(),
  downloadDocumentPdf: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  addDocumentLine: vi.fn(),
  importDocumentLines: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));
vi.mock("../lib/products/api", () => ({ listProducts: vi.fn() }));
vi.mock("../lib/rbac/api", () => ({ listUsers: vi.fn() }));
vi.mock("../lib/inventory/kardex-api", () => ({
  getStock: vi.fn(),
  getKardex: vi.fn(),
  getInTransit: vi.fn(),
}));

const mocked = vi.mocked(inventoryApi);
const mockedWarehouses = vi.mocked(warehousesApi.listWarehouses);
const mockedProducts = vi.mocked(productsApi.listProducts);
const mockedUsers = vi.mocked(rbacApi.listUsers);
const mockedStock = vi.mocked(kardexApi.getStock);

const demoUser = (permissions: string[], usesLocations = false): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: SUBSCRIPTION_PLUS,
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations,
    monthlySalesGoal: null,
  },
});

const detalle = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: "doc-1",
  folio: "ENT-000042",
  type: "entry",
  status: "draft",
  warehouse: { id: "w1", name: "Central" },
  reasonCode: "adjustment",
  reference: null,
  reasonNote: "Sobrante de conteo",
  authorizedBy: null,
  linkedWarehouseId: null,
  transferId: null,
  lineCount: 1,
  createdAt: "2026-08-18T19:42:00.000Z",
  createdBy: { id: "u1", firstName: "Ana", lastNamePaternal: "Pérez" },
  confirmedAt: null,
  rows: [
    {
      id: "line-1",
      lineNo: 1,
      productId: "p1",
      sku: "PAR-500",
      presentationId: null,
      quantityInput: "10",
      quantityBase: "10",
      unitCost: null,
      lotCode: null,
      expiresAt: null,
      location: null,
      newLot: false,
      lotPlan: null,
      available: "5",
      stockBefore: "5",
      stockAfter: "15",
      errors: [],
    },
  ],
  products: [
    {
      id: "p1",
      sku: "PAR-500",
      name: "Paracetamol 500mg",
      baseUnit: "unit",
      isComposite: false,
      tracksLots: false,
      location: null,
      availableUnits: null,
      presentations: [],
    },
  ],
  summary: { lines: 1, products: 1, newLots: 0, errors: 0 },
  ...overrides,
});

async function renderDoc(
  permissions: string[] = ["inventory:read", "inventory:movement"],
  usesLocations = false,
) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions, usesLocations));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/movements/documents/doc-1"] }),
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
  for (const fn of Object.values(mocked)) {
    if (typeof fn === "function" && "mockReset" in fn) {
      (fn as { mockReset: () => void }).mockReset();
    }
  }
  mockedWarehouses.mockReset();
  mockedWarehouses.mockResolvedValue([
    {
      id: "w1",
      code: "ALM-001",
      name: "Central",
      address: null,
      phone: null,
      email: null,
      attributes: {},
      isActive: true,
      deactivationBlockedBy: null,
    },
  ]);
  mockedProducts.mockReset();
  mockedProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  mockedUsers.mockReset();
  mockedUsers.mockResolvedValue([]);
  mockedStock.mockReset();
  mockedStock.mockResolvedValue({
    isComposite: false,
    rows: [],
    total: "0",
    stockMin: "0",
    belowMin: false,
    baseUnit: "unit",
  });
  mocked.getDocument.mockResolvedValue(detalle());
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Pantalla del documento (F3-DOC-09)", () => {
  /**
   * La UBICACIÓN la decide el NEGOCIO, no el lote.
   *
   * Carlos (2026-08-31): «hay productos que no tienen lote ni caducidad y sin
   * embargo sí deberían poder tener ubicación si el negocio tiene activo ese
   * parámetro». Antes el campo colgaba de `tracksLots`, así que justo los
   * productos más comunes se quedaban sin dónde escribirla.
   */
  describe("la caducidad sigue al lote (Carlos, 2026-09-01)", () => {
    const detalleConLote = () =>
      detalle({
        products: [
          {
            id: "p1",
            sku: "PAR-500",
            name: "Paracetamol 500mg",
            baseUnit: "unit",
            isComposite: false,
            tracksLots: true,
            location: null,
            availableUnits: null,
            presentations: [],
          },
        ],
      });

    it("cambiar a OTRO lote conocido re-llena su caducidad — no se queda la del anterior", async () => {
      const user = userEvent.setup();
      mockedStock.mockResolvedValue({
        isComposite: false,
        total: "10",
        stockMin: "0",
        belowMin: false,
        baseUnit: "unit",
        rows: [
          {
            warehouseId: "w1",
            warehouseName: "Central",
            quantity: "10",
            lots: [
              { lotCode: "ST1", expiresAt: "2026-07-01T00:00:00.000Z", quantity: "4" },
              { lotCode: "ST2", expiresAt: "2026-09-30T00:00:00.000Z", quantity: "6" },
            ],
          },
        ],
      } as never);
      mocked.getDocument.mockResolvedValue(detalleConLote());
      await renderDoc();
      await screen.findByText("PAR-500");

      const lote = screen.getByLabelText("Lote");
      await user.click(lote);
      await user.type(lote, "ST1");
      const caducidad = screen.getByLabelText("Caducidad") as HTMLInputElement;
      await waitFor(() => expect(caducidad.value).toBe("2026-07-01"));

      // El bug: al cambiar de lote, la fecha del anterior se quedaba pegada
      // y solo se corregía limpiando el calendario a mano.
      await user.clear(lote);
      await user.type(lote, "ST2");
      await waitFor(() => expect(caducidad.value).toBe("2026-09-30"));
    });
  });

  describe("la ubicación no depende del lote", () => {
    it("la línea nace con la ubicación de la FICHA del producto, editable", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          products: [
            {
              id: "p1",
              sku: "PAR-500",
              name: "Paracetamol 500mg",
              baseUnit: "unit",
              isComposite: false,
              tracksLots: false,
              location: "B-03-07",
              availableUnits: null,
              presentations: [],
            },
          ],
        }),
      );
      await renderDoc(["inventory:read", "inventory:movement"], true);

      await screen.findByText("PAR-500");
      // La ficha dice dónde suele estar: la línea arranca ahí y quien recibe
      // solo corrige si esta vez quedó en otro lado.
      expect(screen.getByLabelText("Ubicación")).toHaveValue("B-03-07");
    });

    it("un producto SIN lote la puede capturar si el negocio usa ubicaciones", async () => {
      await renderDoc(["inventory:read", "inventory:movement"], true);

      await screen.findByText("PAR-500");
      expect(screen.getByLabelText("Ubicación")).toBeInTheDocument();
    });

    it("sin el parámetro del negocio, la columna no aparece", async () => {
      await renderDoc(["inventory:read", "inventory:movement"], false);

      await screen.findByText("PAR-500");
      expect(screen.queryByLabelText("Ubicación")).not.toBeInTheDocument();
    });
  });

  describe("la cara del borrador", () => {
    it("muestra el folio y sus líneas", async () => {
      await renderDoc();

      expect(await screen.findByText("ENT-000042")).toBeInTheDocument();
      expect(screen.getByText("PAR-500")).toBeInTheDocument();
    });

    /**
     * El panel de previa es lo que evita confirmar a ciegas: se ve qué hay y
     * en qué queda, ANTES de tocar el stock.
     */
    it("el panel de previa muestra el stock actual y el resultante", async () => {
      await renderDoc();

      await screen.findByText("PAR-500");
      expect(screen.getByText(/5\s*→\s*15/)).toBeInTheDocument();
    });

    it("editar una cantidad dispara el PATCH con debounce", async () => {
      const user = userEvent.setup();
      mocked.updateDocumentLine.mockResolvedValue({});
      await renderDoc();
      await screen.findByText("PAR-500");

      const input = screen.getByLabelText(/cantidad/i);
      await user.clear(input);
      await user.type(input, "7");

      await waitFor(
        () => {
          expect(mocked.updateDocumentLine).toHaveBeenCalledWith(
            "doc-1",
            expect.any(String),
            expect.objectContaining({ quantity: 7 }),
          );
        },
        { timeout: 2000 },
      );
    });

    it("una línea con error se marca y el confirmar queda deshabilitado", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          rows: [
            {
              // `detalle().rows[0]` es `DocumentRow | undefined` para TS: se
              // estrecha acá en vez de castear en cada uso.
              ...(detalle().rows[0] as DocumentRow),
              errors: [{ field: "quantity", code: "inventory.quantity_must_be_positive" }],
            },
          ],
          summary: { lines: 1, products: 1, newLots: 0, errors: 1 },
        }),
      );

      await renderDoc();

      await screen.findByText("PAR-500");
      expect(screen.getByRole("button", { name: /confirmar/i })).toBeDisabled();
    });

    it("confirmar pide confirmación antes de mover stock", async () => {
      const user = userEvent.setup();
      mocked.confirmDocument.mockResolvedValue({ document: detalle({ status: "confirmed" }) });
      await renderDoc();
      await screen.findByText("PAR-500");

      await user.click(screen.getByRole("button", { name: /confirmar/i }));

      // El diálogo aparece; el API todavía NO se llamó.
      expect(mocked.confirmDocument).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: /^confirmar entrada$/i }));

      await waitFor(() => {
        expect(mocked.confirmDocument).toHaveBeenCalledWith("doc-1");
      });
    });
  });

  describe("la cara del confirmado", () => {
    it("no renderiza inputs ni el botón de confirmar", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({ status: "confirmed", confirmedAt: "2026-08-18T20:00:00.000Z" }),
      );

      await renderDoc();

      await screen.findByText("PAR-500");
      expect(screen.queryByLabelText(/cantidad/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /confirmar/i })).not.toBeInTheDocument();
    });

    it("un anulado tampoco se edita", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ status: "canceled" }));

      await renderDoc();

      await screen.findByText("PAR-500");
      expect(screen.queryByLabelText(/cantidad/i)).not.toBeInTheDocument();
    });
  });

  describe("el PDF", () => {
    /** Carlos (2026-09-02): un borrador no se imprime. El botón ni aparece. */
    it("en borrador NO hay botón de PDF", async () => {
      await renderDoc();
      await screen.findByText("PAR-500");

      expect(screen.queryByRole("button", { name: /pdf/i })).not.toBeInTheDocument();
    });

    it("confirmado, se baja con el folio de nombre", async () => {
      const user = userEvent.setup();
      mocked.downloadDocumentPdf.mockResolvedValue(undefined);
      mocked.getDocument.mockResolvedValue(detalle({ status: "confirmed" }));
      await renderDoc();
      await screen.findByText("PAR-500");

      await user.click(screen.getByRole("button", { name: /pdf/i }));

      await waitFor(() => {
        expect(mocked.downloadDocumentPdf).toHaveBeenCalledWith("doc-1", "ENT-000042");
      });
    });
  });

  describe("permisos", () => {
    it("sin `inventory:movement` se ve pero no se edita ni se confirma", async () => {
      await renderDoc(["inventory:read"]);

      await screen.findByText("PAR-500");
      expect(screen.queryByLabelText(/cantidad/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /confirmar/i })).not.toBeInTheDocument();
      // Y en un borrador tampoco hay PDF: eso no es un permiso, es el estado.
      expect(screen.queryByRole("button", { name: /pdf/i })).not.toBeInTheDocument();
    });
  });
});

/**
 * La cabecera de una recepción de traspaso es DERIVADA, no editable.
 *
 * El bug que esto cierra: el `<select>` de motivo no ofrece "Traspaso" —a
 * propósito, para que nadie convierta una entrada común en traspaso sin que
 * exista el traspaso—, así que un `<select>` controlado con `value="transfer"`
 * caía a su primera opción y la recepción se anunciaba como "Factura de
 * compra". Quien intentara corregir lo que veía solo podía elegir otro motivo,
 * y ese PATCH suelta el `linkedWarehouseId`: la recepción quedaba sin traspaso.
 */
describe("Cabecera de una recepción de traspaso", () => {
  const recepcion = () =>
    detalle({
      folio: "ENT-000002",
      type: "entry",
      transferId: "tr-1",
      reasonCode: "transfer",
      linkedWarehouseId: "w2",
      warehouse: { id: "w1", name: "Almacén Sur" },
    });

  it("el motivo se MUESTRA como traspaso y no se puede cambiar", async () => {
    mocked.getDocument.mockResolvedValue(recepcion());
    await renderDoc();

    expect(await screen.findByTestId("transfer-reason")).toHaveTextContent("Traspaso");
    expect(screen.queryByLabelText(/motivo/i)).not.toBeInTheDocument();
  });

  it("el otro almacén se llama ORIGEN, porque es de donde vino la mercancía", async () => {
    mocked.getDocument.mockResolvedValue(recepcion());
    await renderDoc();

    expect(await screen.findByText("Almacén origen")).toBeInTheDocument();
    expect(screen.queryByText("Almacén destino")).not.toBeInTheDocument();
  });

  it("no se ofrece el selector de almacén: el traspaso ya lo fijó", async () => {
    mocked.getDocument.mockResolvedValue(recepcion());
    await renderDoc();

    await screen.findByTestId("transfer-reason");
    expect(document.getElementById("document-linked-warehouse")).toBeNull();
  });

  it("una entrada COMÚN sigue con su cabecera editable", async () => {
    mocked.getDocument.mockResolvedValue(detalle({ transferId: null }));
    await renderDoc();

    expect(await screen.findByLabelText(/motivo/i)).toBeInTheDocument();
    expect(screen.queryByTestId("transfer-reason")).not.toBeInTheDocument();
  });
});
