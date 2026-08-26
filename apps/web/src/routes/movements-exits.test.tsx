import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
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
 * F3-EXIT-02 — la cara de SALIDA de la pantalla del documento.
 *
 * Lo propio de una salida frente a una entrada: el stock puede NO alcanzar.
 * Por eso la previa muestra el disponible por línea y bloquea antes de mover
 * nada — y lo hace **sumando las líneas del mismo producto**, que es el caso
 * que se escapa cuando cada fila se mira sola.
 *
 * Y el traspaso, que no es un tipo de documento aparte: es esta misma salida
 * con motivo `transfer` y un almacén destino.
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

const mocked = vi.mocked(inventoryApi);
const mockedWarehouses = vi.mocked(warehousesApi.listWarehouses);
const mockedProducts = vi.mocked(productsApi.listProducts);
const mockedUsers = vi.mocked(rbacApi.listUsers);

const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
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
  },
});

const CAJA = {
  id: "pres-caja",
  name: "Caja",
  factor: "12",
  allowFractionalInput: false,
  isPurchasable: true,
  isSellable: true,
};

const fila = (overrides: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "line-1",
  lineNo: 1,
  productId: "p1",
  sku: "PAR-500",
  presentationId: null,
  quantityInput: "3",
  quantityBase: "3",
  unitCost: null,
  lotCode: null,
  expiresAt: null,
  location: null,
  newLot: false,
  available: "10",
  stockBefore: "10",
  stockAfter: "7",
  lotPlan: null,
  errors: [],
  ...overrides,
});

const detalle = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: "doc-1",
  folio: "SAL-000124",
  type: "exit",
  status: "draft",
  warehouse: { id: "w1", name: "Central" },
  reasonCode: null,
  reference: null,
  reasonNote: null,
  authorizedBy: null,
  linkedWarehouseId: null,
  transferId: null,
  lineCount: 1,
  createdAt: "2026-08-18T19:42:00.000Z",
  createdBy: { id: "u1", firstName: "Ana", lastNamePaternal: "Pérez" },
  confirmedAt: null,
  rows: [fila()],
  products: [
    {
      id: "p1",
      sku: "PAR-500",
      name: "Paracetamol 500mg",
      baseUnit: "unit",
      isComposite: false,
      tracksLots: false,
      availableUnits: null,
      presentations: [CAJA],
    },
  ],
  summary: { lines: 1, products: 1, newLots: 0, errors: 0 },
  ...overrides,
});

async function renderDoc(permissions: string[] = ["inventory:read", "inventory:movement"]) {
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
  return router;
}

beforeEach(() => {
  for (const fn of Object.values(mocked)) {
    if (typeof fn === "function" && "mockReset" in fn) {
      (fn as { mockReset: () => void }).mockReset();
    }
  }
  mockedWarehouses.mockReset();
  // TRES almacenes a propósito: excluido el origen quedan dos, así que el
  // selector NO auto-elige y "sin destino" es un estado alcanzable de verdad.
  mockedWarehouses.mockResolvedValue([
    { id: "w1", name: "Central", address: null, isActive: true, deactivationBlockedBy: null },
    { id: "w2", name: "Bodega Norte", address: null, isActive: true, deactivationBlockedBy: null },
    { id: "w3", name: "Bodega Sur", address: null, isActive: true, deactivationBlockedBy: null },
  ]);
  mockedProducts.mockReset();
  mockedProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  mockedUsers.mockReset();
  mockedUsers.mockResolvedValue([]);
  mocked.getDocument.mockResolvedValue(detalle());
  mocked.updateDocumentHeader.mockResolvedValue(detalle());
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("La cara de salida del documento (F3-EXIT-02)", () => {
  describe("los motivos de una salida", () => {
    it("ofrece los de salida, incluido Traspaso, y ninguno de entrada", async () => {
      await renderDoc();

      const select = await screen.findByLabelText(/motivo/i);
      const opciones = within(select)
        .getAllByRole("option")
        .map((o) => o.textContent);

      expect(opciones).toEqual(
        expect.arrayContaining(["Ajuste", "Traspaso", "Merma o pérdida", "Consumo interno"]),
      );
      expect(opciones).not.toContain("Factura de compra");
      expect(opciones).not.toContain("Devolución de cliente");
    });

    /**
     * El consumo pide el ÁREA o el concepto, no un "número de referencia".
     * Reusar la etiqueta genérica dejaría a quien registra un consumo de
     * limpieza buscando qué número inventar.
     */
    it("el consumo interno pide el área o concepto", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "consumption" }));
      await renderDoc();

      expect(await screen.findByLabelText(/área o concepto/i)).toBeInTheDocument();
    });

    it("merma pide Nota y ofrece Autoriza", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "loss" }));
      await renderDoc();

      expect(await screen.findByLabelText(/nota/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/autoriza/i)).toBeInTheDocument();
    });
  });

  describe("el traspaso es esta misma salida con destino", () => {
    it("elegir traspaso muestra el almacén destino y EXCLUYE el origen", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "transfer" }));
      await renderDoc();

      const destino = await screen.findByLabelText(/almacén destino/i);
      const opciones = within(destino)
        .getAllByRole("option")
        .map((o) => o.textContent);

      expect(opciones).toContain("Bodega Norte");
      // El origen es Central: mandarse mercancía a sí mismo no existe, y la
      // base lo rechaza con un CHECK. Que no aparezca es la única forma
      // honesta de decirlo.
      expect(opciones).not.toContain("Central");
    });

    it("avisa que la mercancía queda en tránsito hasta que el destino confirme", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "transfer" }));
      await renderDoc();

      expect(await screen.findByText(/en tránsito/i)).toBeInTheDocument();
    });

    it("elegir destino guarda `linkedWarehouseId`", async () => {
      const user = userEvent.setup();
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "transfer" }));
      await renderDoc();

      await user.selectOptions(await screen.findByLabelText(/almacén destino/i), "w2");

      await waitFor(() => {
        expect(mocked.updateDocumentHeader).toHaveBeenCalledWith(
          "doc-1",
          expect.objectContaining({ linkedWarehouseId: "w2" }),
        );
      });
    });

    it("sin destino elegido no se confirma", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "transfer" }));
      await renderDoc();

      await screen.findByLabelText(/almacén destino/i);
      expect(screen.getByRole("button", { name: /^confirmar$/i })).toBeDisabled();
    });

    it("tras confirmar un traspaso, el panel de éxito lleva a traspasos en tránsito", async () => {
      const user = userEvent.setup();
      mocked.getDocument.mockResolvedValue(
        detalle({ reasonCode: "transfer", linkedWarehouseId: "w2" }),
      );
      mocked.confirmDocument.mockResolvedValue({
        document: detalle({ status: "confirmed", reasonCode: "transfer" }),
      });
      await renderDoc();
      await screen.findByText("PAR-500");

      await user.click(screen.getByRole("button", { name: /^confirmar$/i }));
      await user.click(screen.getByRole("button", { name: /^confirmar salida$/i }));

      const panel = await screen.findByRole("status");
      const link = within(panel).getByRole("link", { name: /tránsito/i });

      expect(link).toHaveAttribute("href", "/movements/transfers");
    });

    /**
     * Una salida por merma no tiene destino: ofrecerlo sería ruido.
     *
     * Se busca por TEXTO y no por `queryByLabelText`: mientras el selector de
     * almacenes está cargando renderiza "Cargando…" en vez del `<select>`, así
     * que la etiqueta no apunta a ningún control y `queryByLabelText` daría
     * null aunque el campo esté ahí. La primera versión de este test pasaba
     * con el destino renderizado SIEMPRE — no tenía dientes.
     */
    it("una merma no muestra almacén destino", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "loss" }));
      await renderDoc();

      await screen.findByLabelText(/nota/i);
      expect(screen.queryByText(/almacén destino/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/en tránsito/i)).not.toBeInTheDocument();
    });
  });

  describe("el disponible por línea", () => {
    it("muestra lo que hay en unidad base", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "loss", reasonNote: "rota" }));
      await renderDoc();

      const filaProducto = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

      expect(within(filaProducto).getByText(/disponible:\s*10/i)).toBeInTheDocument();
    });

    /**
     * "120 unidades = 10 Caja": quien saca en cajas necesita el disponible en
     * cajas, no hacer la división de cabeza sobre el mostrador.
     */
    it("con presentación elegida también lo dice en esa presentación", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          reasonCode: "loss",
          reasonNote: "rota",
          rows: [fila({ presentationId: "pres-caja", available: "120", quantityBase: "36" })],
        }),
      );
      await renderDoc();

      const filaProducto = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

      expect(within(filaProducto).getByText(/120.*=.*10\s*Caja/i)).toBeInTheDocument();
    });

    /**
     * El caso que se escapa cuando cada fila se valida sola: dos líneas del
     * MISMO producto, 6 + 5 sobre 10 disponibles. El servidor las encadena
     * (la segunda parte del saldo que dejó la primera) y marca la que se pasa.
     */
    it("dos líneas del mismo producto que juntas exceden el stock se marcan", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          reasonCode: "loss",
          reasonNote: "rota",
          rows: [
            fila({
              lineNo: 1,
              quantityInput: "6",
              quantityBase: "6",
              stockBefore: "10",
              stockAfter: "4",
              available: "10",
            }),
            fila({
              lineNo: 2,
              quantityInput: "5",
              quantityBase: "5",
              stockBefore: "4",
              stockAfter: "-1",
              available: "4",
              errors: [
                {
                  field: "quantity",
                  code: "inventory.insufficient_stock",
                  args: { sku: "PAR-500", available: "4", requested: "5" },
                },
              ],
            }),
          ],
          summary: { lines: 2, products: 1, newLots: 0, errors: 1 },
        }),
      );
      await renderDoc();

      const filas = (await screen.findAllByText("PAR-500")).map(
        (el) => el.closest("tr") as HTMLElement,
      );

      expect(
        within(filas[1] as HTMLElement).getByText(/No hay suficiente existencia/i),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^confirmar$/i })).toBeDisabled();
    });
  });

  /**
   * F3-EXIT-02 — el reparto FEFO y el techo de un compuesto.
   *
   * El reparto sale del MISMO `allocateFefo` que usa el confirm: lo que se ve
   * acá es de donde realmente va a salir la mercancía, no una estimación.
   */
  describe("de qué lote va a salir", () => {
    it("dice el lote y su caducidad, por línea", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          reasonCode: "loss",
          reasonNote: "rota",
          rows: [
            fila({
              quantityInput: "1",
              quantityBase: "1",
              lotPlan: [{ lotCode: "st10", expiresAt: "2026-07-01", location: "", quantity: "1" }],
            }),
          ],
          products: [
            {
              id: "p1",
              sku: "PAR-500",
              name: "Paracetamol 500mg",
              baseUnit: "unit",
              isComposite: false,
              tracksLots: true,
              availableUnits: null,
              presentations: [],
            },
          ],
        }),
      );
      await renderDoc();

      const filaProducto = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

      expect(within(filaProducto).getByText(/st10/)).toBeInTheDocument();
      expect(within(filaProducto).getByText(/01\/07\/2026/)).toBeInTheDocument();
    });

    /** Cuando el primero no alcanza, se ven los DOS de dónde sale. */
    it("muestra el reparto entre varios lotes", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          reasonCode: "loss",
          reasonNote: "rota",
          rows: [
            fila({
              quantityInput: "5",
              quantityBase: "5",
              lotPlan: [
                { lotCode: "st10", expiresAt: "2026-07-01", location: "", quantity: "2" },
                { lotCode: "st30", expiresAt: "2026-09-30", location: "", quantity: "3" },
              ],
            }),
          ],
          products: [
            {
              id: "p1",
              sku: "PAR-500",
              name: "Paracetamol 500mg",
              baseUnit: "unit",
              isComposite: false,
              tracksLots: true,
              availableUnits: null,
              presentations: [],
            },
          ],
        }),
      );
      await renderDoc();

      const filaProducto = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

      expect(within(filaProducto).getByText(/st10/)).toBeInTheDocument();
      expect(within(filaProducto).getByText(/st30/)).toBeInTheDocument();
    });

    /** Un producto sin lotes no tiene reparto que mostrar. */
    it("sin lotes no dice nada de lotes", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "loss", reasonNote: "rota" }));
      await renderDoc();

      await screen.findByText("PAR-500");
      expect(screen.queryByText(/saldrá del lote/i)).not.toBeInTheDocument();
    });
  });

  describe("un producto compuesto", () => {
    it("avisa que se descuentan sus componentes y cuántas unidades se pueden armar", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          reasonCode: "consumption",
          reference: "cocina",
          products: [
            {
              id: "p1",
              sku: "PAR-500",
              name: "Pan",
              baseUnit: "unit",
              isComposite: true,
              tracksLots: false,
              availableUnits: 3,
              presentations: [],
            },
          ],
        }),
      );
      await renderDoc();

      const filaProducto = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

      expect(within(filaProducto).getByText(/se descontarán sus componentes/i)).toBeInTheDocument();
      // El techo son las unidades ARMABLES con lo que hay EN ESTE almacén.
      expect(within(filaProducto).getByText(/se pueden armar 3/i)).toBeInTheDocument();
    });
  });
});
