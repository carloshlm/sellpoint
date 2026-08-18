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
 * F3-ENTRY-02 — la cara de ENTRADA de la pantalla del documento.
 *
 * Lo que esta tarea agrega sobre F3-DOC-09: el motivo se elige, y elegirlo
 * cambia qué campos pide el formulario. Esa reactividad no es cosmética —
 * sale de `REASON_RULES`, la misma tabla que valida el API, y es lo que evita
 * que el usuario descubra un requisito recién en el 400.
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
  locale: "es",
  permissions,
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
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
  lotPlan: null,
  available: "5",
  stockBefore: "5",
  stockAfter: "8",
  errors: [],
  ...overrides,
});

const detalle = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  id: "doc-1",
  folio: "ENT-000042",
  type: "entry",
  status: "draft",
  warehouse: { id: "w1", name: "Central" },
  reasonCode: null,
  reference: null,
  reasonNote: null,
  authorizedBy: null,
  linkedWarehouseId: null,
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
  mockedWarehouses.mockResolvedValue([
    { id: "w1", name: "Central", address: null, isActive: true },
  ]);
  mockedProducts.mockReset();
  mockedProducts.mockResolvedValue({ total: 0, page: 1, pageSize: 20, items: [] });
  mockedUsers.mockReset();
  mockedUsers.mockResolvedValue([
    {
      id: "u9",
      email: "jefe@acme.mx",
      firstName: "Beto",
      lastNamePaternal: "Ruiz",
      lastNameMaternal: null,
      status: "active",
      locale: "es",
      roles: [],
    },
  ]);
  mocked.getDocument.mockResolvedValue(detalle());
  mocked.updateDocumentHeader.mockResolvedValue(detalle());
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("La cara de entrada del documento (F3-ENTRY-02)", () => {
  describe("el motivo manda", () => {
    it("ofrece solo los motivos elegibles de una entrada", async () => {
      await renderDoc();

      const select = await screen.findByLabelText(/motivo/i);
      const opciones = within(select)
        .getAllByRole("option")
        .map((o) => o.textContent);

      expect(opciones).toEqual(
        expect.arrayContaining(["Factura de compra", "Ajuste", "Devolución de cliente"]),
      );
      // El traspaso en ENTRADA no se elige a mano: lo precarga la recepción.
      expect(opciones).not.toContain("Traspaso");
      // Ni los que emite el sistema.
      expect(opciones).not.toContain("Venta");
    });

    it("elegir factura muestra Referencia y la columna de costo, y oculta Autoriza", async () => {
      const user = userEvent.setup();
      await renderDoc();
      await screen.findByLabelText(/motivo/i);

      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "invoice" }));
      await user.selectOptions(screen.getByLabelText(/motivo/i), "invoice");

      await waitFor(() => {
        expect(mocked.updateDocumentHeader).toHaveBeenCalledWith(
          "doc-1",
          expect.objectContaining({ reasonCode: "invoice" }),
        );
      });

      expect(await screen.findByLabelText(/referencia/i)).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: /costo/i })).toBeInTheDocument();
      expect(screen.queryByLabelText(/autoriza/i)).not.toBeInTheDocument();
    });

    it("elegir ajuste exige Nota, ofrece Autoriza y esconde el costo", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "adjustment" }));
      await renderDoc();

      expect(await screen.findByLabelText(/nota/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/autoriza/i)).toBeInTheDocument();
      expect(screen.queryByRole("columnheader", { name: /costo/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/referencia/i)).not.toBeInTheDocument();
    });

    /**
     * La regla sale de `REASON_RULES`, así que el formulario bloquea ANTES de
     * mandar: enterarse de que faltaba la nota por un 400 sería descubrir un
     * requisito que la pantalla nunca mostró.
     */
    it("un ajuste sin nota no deja confirmar y lo dice sobre el campo", async () => {
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "adjustment" }));
      await renderDoc();

      await screen.findByLabelText(/nota/i);

      expect(screen.getByRole("button", { name: /^confirmar$/i })).toBeDisabled();
      expect(screen.getByText(/Falta la explicación/i)).toBeInTheDocument();
    });

    it("con la nota puesta, el confirmar se habilita", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({ reasonCode: "adjustment", reasonNote: "Sobrante de conteo" }),
      );
      await renderDoc();

      await screen.findByLabelText(/nota/i);

      expect(screen.getByRole("button", { name: /^confirmar$/i })).toBeEnabled();
    });

    /**
     * Sin motivo elegido no hay documento que confirmar — pero tampoco hay que
     * gritarle a quien recién abrió la pantalla.
     */
    it("sin motivo elegido no se confirma, y no se marca nada en rojo", async () => {
      await renderDoc();

      await screen.findByLabelText(/motivo/i);

      expect(screen.getByRole("button", { name: /^confirmar$/i })).toBeDisabled();
      expect(screen.queryByText(/es obligatoria/i)).not.toBeInTheDocument();
    });
  });

  describe("la equivalencia por línea", () => {
    it("con presentación elegida dice cuánto es en unidad base", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({ rows: [fila({ presentationId: "pres-caja", quantityBase: "36" })] }),
      );
      await renderDoc();

      expect(await screen.findByText(/3\s*Caja\s*=\s*36\s*unidades/i)).toBeInTheDocument();
    });

    it("cambiar la presentación manda el PATCH de esa línea", async () => {
      const user = userEvent.setup();
      mocked.updateDocumentLine.mockResolvedValue({});
      await renderDoc();
      await screen.findByText("PAR-500");

      await user.selectOptions(screen.getByLabelText(/presentación/i), "pres-caja");

      await waitFor(() => {
        expect(mocked.updateDocumentLine).toHaveBeenCalledWith(
          "doc-1",
          "1",
          expect.objectContaining({ presentationId: "pres-caja" }),
        );
      });
    });

    /** Sin presentación la cantidad YA está en unidad base: repetirlo sería ruido. */
    it("sin presentación no pinta equivalencia", async () => {
      await renderDoc();

      await screen.findByText("PAR-500");
      expect(screen.queryByText(/=/)).not.toBeInTheDocument();
    });
  });

  describe("los errores del servidor caen sobre su fila", () => {
    it("el 422 de solo-enteros se pinta en la línea que lo provocó", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({
          rows: [
            fila({
              presentationId: "pres-caja",
              quantityInput: "1.5",
              errors: [
                {
                  field: "quantity",
                  code: "inventory.integer_only_presentation",
                  args: { presentationName: "Caja" },
                },
              ],
            }),
          ],
          summary: { lines: 1, products: 1, newLots: 0, errors: 1 },
        }),
      );
      await renderDoc();

      const fila1 = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;

      expect(within(fila1).getByText(/Caja.*solo acepta cantidades enteras/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^confirmar$/i })).toBeDisabled();
    });
  });

  describe("agregar líneas con el buscador", () => {
    it("busca productos y agrega el elegido como línea nueva", async () => {
      const user = userEvent.setup();
      mockedProducts.mockResolvedValue({
        total: 1,
        page: 1,
        pageSize: 20,
        items: [
          {
            id: "p2",
            sku: "IBU-400",
            name: "Ibuprofeno 400mg",
            baseUnit: "unit",
            isComposite: false,
            isActive: true,
            attributes: {},
            price: null,
          },
        ],
      });
      mocked.addDocumentLine.mockResolvedValue({});
      await renderDoc();
      await screen.findByText("PAR-500");

      await user.type(screen.getByLabelText(/buscar producto/i), "ibu");

      const resultado = await screen.findByRole("button", { name: /IBU-400/ });
      await user.click(resultado);

      await waitFor(() => {
        expect(mocked.addDocumentLine).toHaveBeenCalledWith(
          "doc-1",
          expect.objectContaining({ productId: "p2" }),
        );
      });
    });

    it("un confirmado no ofrece el buscador", async () => {
      mocked.getDocument.mockResolvedValue(
        detalle({ status: "confirmed", reasonCode: "invoice", reference: "F-1" }),
      );
      await renderDoc();

      await screen.findByText("PAR-500");
      expect(screen.queryByLabelText(/buscar producto/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/motivo/i)).not.toBeInTheDocument();
    });
  });

  describe("el panel de éxito", () => {
    it("tras confirmar muestra el folio y deja bajar el PDF", async () => {
      const user = userEvent.setup();
      mocked.getDocument.mockResolvedValue(detalle({ reasonCode: "invoice", reference: "F-8891" }));
      mocked.confirmDocument.mockResolvedValue({
        document: detalle({ status: "confirmed", reasonCode: "invoice" }),
      });
      await renderDoc();
      await screen.findByText("PAR-500");

      await user.click(screen.getByRole("button", { name: /^confirmar$/i }));
      await user.click(screen.getByRole("button", { name: /^confirmar entrada$/i }));

      const panel = await screen.findByRole("status");

      expect(within(panel).getByText(/ENT-000042/)).toBeInTheDocument();
      expect(within(panel).getByRole("button", { name: /pdf/i })).toBeInTheDocument();
    });
  });
});
