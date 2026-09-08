import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { buildWarehouse } from "@/test/warehouse-fixture";
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

const demoUser = (permissions: string[], usesLocations = false): AuthUser =>
  buildAuthUser({ permissions, tenant: buildTenantBlock({ usesLocations: usesLocations }) });

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
  createdBy: { id: "u1", firstName: "Ana", lastName: "Pérez" },
  confirmedAt: null,
  canceledAt: null,
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
  mockedWarehouses.mockResolvedValue([buildWarehouse()]);
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

/**
 * Carlos (2026-09-02): la cabecera del documento dice cuándo se abrió y
 * cuándo se asentó o canceló, con hora, en la zona del negocio. No decía
 * ninguna fecha.
 */
describe("la cabecera dice las fechas del documento", () => {
  it("un borrador solo tiene apertura", async () => {
    await renderDoc();
    await screen.findByText("PAR-500");

    expect(screen.getByText(/Abierto 18\/08\/26/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmado/)).not.toBeInTheDocument();
  });

  it("un confirmado dice apertura y confirmación", async () => {
    mocked.getDocument.mockResolvedValue(
      detalle({ status: "confirmed", confirmedAt: "2026-08-20T16:00:00.000Z" }),
    );
    await renderDoc();
    await screen.findByText("PAR-500");

    expect(screen.getByText(/Abierto 18\/08\/26.*Confirmado 20\/08\/26/)).toBeInTheDocument();
  });

  it("un cancelado dice apertura y cancelación", async () => {
    mocked.getDocument.mockResolvedValue(
      detalle({ status: "canceled", canceledAt: "2026-08-21T16:00:00.000Z" }),
    );
    await renderDoc();
    await screen.findByText("PAR-500");

    expect(screen.getByText(/Abierto 18\/08\/26.*Cancelado 21\/08\/26/)).toBeInTheDocument();
  });
});

/**
 * Carlos (2026-09-02): «asentar» es jerga contable de un solo país. El
 * diálogo dice «registrar», y concuerda en número: una línea o varias.
 */
describe("el diálogo de confirmar habla en plural o singular", () => {
  it("con una línea: «Se registrará 1 línea»", async () => {
    const user = userEvent.setup();
    await renderDoc();
    await screen.findByText("PAR-500");

    await user.click(screen.getByRole("button", { name: /^confirmar$/i }));

    expect(screen.getByText(/^Se registrará 1 línea y el stock/)).toBeInTheDocument();
    expect(screen.queryByText(/asentar/i)).not.toBeInTheDocument();
  });

  it("con dos líneas: «Se registrarán 2 líneas»", async () => {
    const user = userEvent.setup();
    const base = detalle();
    const segunda = { ...(base.rows[0] as (typeof base.rows)[number]), id: "line-2", lineNo: 2 };
    mocked.getDocument.mockResolvedValue(detalle({ rows: [...base.rows, segunda] }));
    await renderDoc();
    await screen.findAllByText("PAR-500");

    await user.click(screen.getByRole("button", { name: /^confirmar$/i }));

    expect(screen.getByText(/^Se registrarán 2 líneas y el stock/)).toBeInTheDocument();
  });
});

/**
 * Carlos, 2026-09-08: «en las entradas por factura dale formato al Costo
 * unitario como a los demás inputs de moneda». Es el único importe de la
 * pantalla y el que alimenta el costo del inventario, así que va con la
 * moneda del negocio a la vista y a dos decimales.
 *
 * Lo delicado es que esta línea se AUTOGUARDA con debounce: el campo formatea
 * al salir, y un formateo NO es un cambio de importe. Si lo fuera, abrir un
 * documento guardaría solo — y tras cada guardado el API devuelve «6», el
 * campo mostraría «6.00», y el ciclo no pararía nunca.
 */
describe("Costo unitario de una entrada por factura (2026-09-08)", () => {
  const conFactura = (unitCost: string | null) =>
    detalle({
      reasonCode: "invoice",
      reference: "F001",
      reasonNote: null,
      rows: detalle().rows.map((fila) => ({ ...fila, unitCost })),
    });

  const campoCosto = () => screen.getByLabelText(/costo unitario/i);

  it("muestra el símbolo y el código de la moneda del negocio", async () => {
    mocked.getDocument.mockResolvedValue(conFactura("6"));
    await renderDoc();
    await screen.findByText("PAR-500");

    const caja = campoCosto().parentElement as HTMLElement;
    expect(within(caja).getByText("$")).toBeInTheDocument();
    expect(within(caja).getByText("MXN")).toBeInTheDocument();
  });

  it("abre a dos decimales lo que el API devuelve sin ceros («6» → «6.00»)", async () => {
    mocked.getDocument.mockResolvedValue(conFactura("6"));
    await renderDoc();
    await screen.findByText("PAR-500");

    expect(campoCosto()).toHaveValue("6.00");
  });

  /**
   * ⚠ EL QUE MÁS IMPORTA. Formatear no es editar: «6» y «6.00» son el mismo
   * costo, y guardar por esa diferencia dispararía un PATCH al abrir cada
   * documento y otro tras cada respuesta del API.
   */
  it("entrar y salir del campo sin cambiar el importe NO guarda nada", async () => {
    const user = userEvent.setup();
    mocked.getDocument.mockResolvedValue(conFactura("6"));
    mocked.updateDocumentLine.mockResolvedValue({});
    await renderDoc();
    await screen.findByText("PAR-500");

    await user.click(campoCosto());
    await user.tab();
    // Y tampoco escribiendo el MISMO importe con otro texto.
    await user.clear(campoCosto());
    await user.type(campoCosto(), "6.00");

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mocked.updateDocumentLine).not.toHaveBeenCalled();
  });

  it("cambiar el costo sí guarda, con el número", async () => {
    const user = userEvent.setup();
    mocked.getDocument.mockResolvedValue(conFactura("6"));
    mocked.updateDocumentLine.mockResolvedValue({});
    await renderDoc();
    await screen.findByText("PAR-500");

    await user.clear(campoCosto());
    await user.type(campoCosto(), "7.5");

    await waitFor(
      () => {
        expect(mocked.updateDocumentLine).toHaveBeenCalledWith(
          "doc-1",
          expect.any(String),
          expect.objectContaining({ unitCost: 7.5 }),
        );
      },
      { timeout: 2000 },
    );
  });

  /**
   * El campo pasó de `type="number"` a texto: ahora SÍ se pueden teclear
   * letras o una coma. Guardarlas como `null` borraría el costo por una tecla
   * mal puesta, en silencio. No se guarda nada y el campo queda marcado.
   */
  it("un texto que no es un importe no borra el costo: no llama al API y se marca", async () => {
    const user = userEvent.setup();
    mocked.getDocument.mockResolvedValue(conFactura("6"));
    mocked.updateDocumentLine.mockResolvedValue({});
    await renderDoc();
    await screen.findByText("PAR-500");

    await user.clear(campoCosto());
    await user.type(campoCosto(), "6,50");

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mocked.updateDocumentLine).not.toHaveBeenCalled();
    expect(campoCosto()).toHaveAttribute("aria-invalid", "true");
    // Y lo dice EN la línea: en un documento de cuarenta, un aviso suelto
    // arriba no señala a ninguna.
    expect(screen.getByText(/punto decimal/)).toBeInTheDocument();
  });

  it("la línea sin costo se marca con el error que manda el servidor", async () => {
    mocked.getDocument.mockResolvedValue({
      ...conFactura(null),
      summary: { ...conFactura(null).summary, errors: 1 },
      rows: conFactura(null).rows.map((fila) => ({
        ...fila,
        errors: [{ field: "unitCost", code: "inventory.unit_cost_required", args: { lineNo: 1 } }],
      })),
    });
    await renderDoc();
    await screen.findByText("PAR-500");

    const fila = screen.getByText("PAR-500").closest("tr") as HTMLElement;
    expect(within(fila).getByText(/Falta el costo unitario/)).toBeInTheDocument();
  });

  it("confirmado, el costo se LEE formateado: la columna no vuelve al decimal crudo", async () => {
    mocked.getDocument.mockResolvedValue({ ...conFactura("6"), status: "confirmed" });
    await renderDoc();
    await screen.findByText("PAR-500");

    expect(screen.queryByLabelText(/costo unitario/i)).not.toBeInTheDocument();
    expect(screen.getByText("$6.00")).toBeInTheDocument();
  });

  it("vaciar el costo SÍ lo borra: vacío es «sin capturar», y eso es un cambio real", async () => {
    const user = userEvent.setup();
    mocked.getDocument.mockResolvedValue(conFactura("6"));
    mocked.updateDocumentLine.mockResolvedValue({});
    await renderDoc();
    await screen.findByText("PAR-500");

    await user.clear(campoCosto());

    await waitFor(
      () => {
        expect(mocked.updateDocumentLine).toHaveBeenCalledWith(
          "doc-1",
          expect.any(String),
          expect.objectContaining({ unitCost: null }),
        );
      },
      { timeout: 2000 },
    );
  });
});
