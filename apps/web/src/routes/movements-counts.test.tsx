import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import * as inventoryApi from "../lib/inventory/api";
import type { DocumentDetail, DocumentRow } from "../lib/inventory/types";
import * as productsApi from "../lib/products/api";
import { createQueryClient } from "../lib/query-client";
import * as rbacApi from "../lib/rbac/api";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-COUNT-04/05 — la cara de INVENTARIO FÍSICO de la pantalla del documento.
 *
 * Dos cosas que la distinguen de una entrada o una salida:
 *
 *  · la reconciliación es la PREVIA del borrador, no una pantalla aparte: cada
 *    línea muestra teórico, contado y diferencia;
 *  · **solo `inventory:manage` aprueba**. Sin ese permiso el borrador se
 *    captura igual y queda esperando a quien pueda firmarlo — que es media
 *    razón por la que el conteo es un borrador y no un formulario.
 */
vi.mock("../lib/inventory/api", () => ({
  getDocument: vi.fn(),
  updateDocumentHeader: vi.fn(),
  updateDocumentLine: vi.fn(),
  removeDocumentLine: vi.fn(),
  confirmDocument: vi.fn(),
  cancelDocument: vi.fn(),
  downloadDocumentPdf: vi.fn(),
  downloadCountTemplate: vi.fn(),
  listDocuments: vi.fn(),
  listExpiring: vi.fn(),
  createDocument: vi.fn(),
  addDocumentLine: vi.fn(),
  importDocumentLines: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));
vi.mock("../lib/products/api", () => ({ listProducts: vi.fn() }));
vi.mock("../lib/rbac/api", () => ({ listUsers: vi.fn() }));

const mocked = vi.mocked(inventoryApi);
const mockedWarehouses = vi.mocked(warehousesApi.listWarehouses);

const demoUser = (permissions: string[]): AuthUser => ({
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
    usesLocations: false,
  },
});

const fila = (overrides: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "line-1",
  lineNo: 1,
  productId: "p1",
  sku: "PAR-500",
  presentationId: null,
  quantityInput: null,
  quantityBase: null,
  unitCost: null,
  lotCode: null,
  expiresAt: null,
  location: null,
  newLot: false,
  available: "40",
  stockBefore: "40",
  stockAfter: "40",
  lotPlan: null,
  theoretical: "40",
  counted: "35",
  difference: "-5",
  errors: [],
  ...overrides,
});

const detalle = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: "doc-1",
  folio: "INV-000007",
  type: "physical_count",
  status: "draft",
  warehouse: { id: "w1", name: "Central" },
  reasonCode: null,
  reference: null,
  reasonNote: null,
  authorizedBy: null,
  linkedWarehouseId: null,
  transferId: null,
  lineCount: 1,
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: { id: "u1", firstName: "Ana", lastNamePaternal: "Pérez" },
  confirmedAt: null,
  rows: [fila()],
  products: [
    {
      id: "p1",
      sku: "PAR-500",
      name: "Paracetamol",
      baseUnit: "unit",
      isComposite: false,
      tracksLots: false,
      availableUnits: null,
      presentations: [],
    },
  ],
  countSummary: { counted: 1, matches: 0, discrepancies: 1, skipped: 0, newLots: 0 },
  summary: { lines: 1, products: 1, newLots: 0, errors: 0 },
  ...overrides,
});

async function renderCount(permissions: string[] = ["inventory:read", "inventory:movement"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
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
  return { router, user: userEvent.setup() };
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
      name: "Central",
      address: null,
      phone: null,
      email: null,
      attributes: {},
      isActive: true,
      deactivationBlockedBy: null,
    },
  ]);
  vi.mocked(productsApi.listProducts).mockResolvedValue({
    total: 0,
    page: 1,
    pageSize: 20,
    items: [],
  });
  vi.mocked(rbacApi.listUsers).mockResolvedValue([]);
  mocked.getDocument.mockResolvedValue(detalle());
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Inventario físico: captura (F3-COUNT-04)", () => {
  it("la plantilla se pide para el almacén del documento", async () => {
    mocked.downloadCountTemplate.mockResolvedValue(undefined);
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    await user.click(screen.getByRole("button", { name: /plantilla .xlsx/i }));

    await waitFor(() => {
      expect(mocked.downloadCountTemplate).toHaveBeenCalledWith("w1", "xlsx");
    });
  });

  it("también se puede bajar en csv", async () => {
    mocked.downloadCountTemplate.mockResolvedValue(undefined);
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    await user.click(screen.getByRole("button", { name: /plantilla .csv/i }));

    await waitFor(() => {
      expect(mocked.downloadCountTemplate).toHaveBeenLastCalledWith("w1", "csv");
    });
  });

  /** Input `sr-only` + label, el patrón de F2-IMPORT: un `<input file>` crudo no se puede estilar. */
  it("el control de archivo está oculto detrás de su etiqueta", async () => {
    await renderCount();
    await screen.findByText("INV-000007");

    expect(screen.getByLabelText(/subir conteo/i)).toHaveClass("sr-only");
  });

  it("subir el archivo lo manda al borrador, en base64", async () => {
    mocked.importDocumentLines.mockResolvedValue({ imported: 1, withErrors: 0, rows: [] });
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    const archivo = new File(["sku,contado\nPAR-500,35"], "conteo.csv", { type: "text/csv" });
    await user.upload(screen.getByLabelText(/subir conteo/i), archivo);

    await waitFor(() => {
      expect(mocked.importDocumentLines).toHaveBeenCalledWith(
        "doc-1",
        expect.objectContaining({ format: "csv", mode: "replace" }),
      );
    });
  });

  /**
   * El teórico se relee al aprobar, no al contar. Decirlo evita la pregunta
   * más frecuente de un inventario: "¿y si alguien vende mientras cuento?".
   */
  it("avisa que el conteo se aplica sobre el saldo del momento de aprobar", async () => {
    await renderCount();

    expect(await screen.findByText(/saldo del momento de aprobar/i)).toBeInTheDocument();
  });
});

describe("Inventario físico: reconciliación y aprobación (F3-COUNT-05)", () => {
  it("cada línea muestra teórico, contado y diferencia", async () => {
    await renderCount();

    const filaProducto = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

    // El teórico y la diferencia son lectura; lo CONTADO es el campo que se
    // captura, así que vive en un input (2026-08-31).
    expect(within(filaProducto).getByText("40")).toBeInTheDocument();
    expect(within(filaProducto).getByLabelText(/Contado/i)).toHaveValue(35);
    expect(within(filaProducto).getByText("-5")).toBeInTheDocument();
  });

  /**
   * ── LO QUE SE EDITA EN UN CONTEO ES LO CONTADO (Carlos, 2026-08-31) ──
   *
   * El campo editable mandaba `quantity`, pero en una línea de conteo
   * `quantity` guarda **el teórico que se vio al capturar**: lo contado vive
   * en `counted`. Así que corregir una cantidad en pantalla no corregía el
   * conteo — pisaba el teórico, y al aprobar se asentaba lo del Excel.
   *
   * Carlos lo vio como "el inventario me suma": tecleó 28 donde el archivo
   * decía 10, y el sistema iba a aplicar 10.
   */
  it("editar la cantidad guarda lo CONTADO, no el teórico", async () => {
    mocked.updateDocumentLine.mockResolvedValue(undefined as never);
    await renderCount();
    const user = userEvent.setup();

    const campo = await screen.findByLabelText(/Contado/i);
    await user.clear(campo);
    await user.type(campo, "28");

    await waitFor(
      () => {
        expect(mocked.updateDocumentLine).toHaveBeenCalledWith(
          "doc-1",
          "line-1",
          expect.objectContaining({ counted: 28 }),
        );
      },
      { timeout: 3000 },
    );
    // Y NUNCA el teórico: pisarlo falsea la reconciliación.
    expect(mocked.updateDocumentLine).not.toHaveBeenCalledWith(
      "doc-1",
      "line-1",
      expect.objectContaining({ quantity: 28 }),
    );
  });

  /**
   * Carlos: «me aparecen columnas repetidas como Cantidad; Lote, Caducidad,
   * Ubicación y Stock no están alineadas con su encabezado».
   *
   * El conteo agregaba TRES celdas al cuerpo (teórico, contado, diferencia)
   * y ningún encabezado, así que todo lo que venía después salía corrido.
   */
  it("los encabezados coinciden con las celdas: nada queda corrido", async () => {
    await renderCount();

    const tabla = (await screen.findByText("PAR-500")).closest("table") as HTMLElement;
    const encabezados = within(tabla).getAllByRole("columnheader").length;
    const celdas = within(
      (await screen.findByText("PAR-500")).closest("tr") as HTMLElement,
    ).getAllByRole("cell").length;

    expect(celdas).toBe(encabezados);
  });

  it("el resumen sale de `countSummary`", async () => {
    mocked.getDocument.mockResolvedValue(
      detalle({
        countSummary: { counted: 12, matches: 9, discrepancies: 3, skipped: 4, newLots: 2 },
      }),
    );
    await renderCount();

    const resumen = await screen.findByTestId("count-summary");

    expect(resumen).toHaveTextContent("12");
    expect(resumen).toHaveTextContent("3");
    expect(resumen).toHaveTextContent("4");
  });

  it("«solo discrepancias» esconde las líneas que coinciden", async () => {
    mocked.getDocument.mockResolvedValue(
      detalle({
        rows: [
          fila({ id: "l1", lineNo: 1, sku: "IGUAL-1", counted: "40", difference: "0" }),
          fila({ id: "l2", lineNo: 2, sku: "DIFIERE-1", counted: "35", difference: "-5" }),
        ],
      }),
    );
    const { user } = await renderCount();
    await screen.findByText("IGUAL-1");

    await user.click(screen.getByLabelText(/solo discrepancias/i));

    expect(screen.queryByText("IGUAL-1")).not.toBeInTheDocument();
    expect(screen.getByText("DIFIERE-1")).toBeInTheDocument();
  });

  it("una línea con lote nuevo se marca", async () => {
    mocked.getDocument.mockResolvedValue(
      detalle({ rows: [fila({ newLot: true, lotCode: "encontrado" })] }),
    );
    await renderCount();

    const filaProducto = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

    expect(within(filaProducto).getByText(/lote nuevo/i)).toBeInTheDocument();
  });

  /**
   * Sin `inventory:manage` el borrador se captura igual y queda esperando: es
   * media razón por la que el conteo es un borrador y no un formulario.
   */
  it("sin `inventory:manage` no hay botón de aprobar, y se explica por qué", async () => {
    await renderCount(["inventory:read", "inventory:movement"]);

    await screen.findByText("PAR-500");
    expect(screen.queryByRole("button", { name: /^confirmar$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/debe aprobar este conteo/i)).toBeInTheDocument();
  });

  it("con `inventory:manage` sí se puede aprobar", async () => {
    await renderCount(["inventory:read", "inventory:movement", "inventory:manage"]);

    await screen.findByText("PAR-500");
    expect(screen.getByRole("button", { name: /^confirmar$/i })).toBeEnabled();
  });

  /** La deriva no se esconde: alguien movió el saldo mientras se contaba. */
  it("tras aprobar con deriva, se advierte", async () => {
    const user = userEvent.setup();
    mocked.confirmDocument.mockResolvedValue({
      document: detalle({ status: "confirmed" }),
      drifted: 2,
    } as never);
    await renderCount(["inventory:read", "inventory:movement", "inventory:manage"]);
    await screen.findByText("PAR-500");

    await user.click(screen.getByRole("button", { name: /^confirmar$/i }));
    await user.click(await screen.findByRole("button", { name: /^confirmar inventario físico$/i }));

    expect(await screen.findByText(/2 líneas cambiaron/i)).toBeInTheDocument();
  });
});
