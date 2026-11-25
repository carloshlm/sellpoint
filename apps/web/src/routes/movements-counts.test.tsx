import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { buildAuthUser } from "@/test/auth-fixture";
import { buildWarehouse } from "@/test/warehouse-fixture";
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
  printDocumentPdf: vi.fn(),
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

const demoUser = (permissions: string[]): AuthUser => buildAuthUser({ permissions });

const fila = (overrides: Partial<DocumentRow> = {}): DocumentRow => ({
  id: "line-1",
  lineNo: 1,
  productId: "p1",
  sku: "PAR-500",
  presentationId: null,
  quantityInput: null,
  quantityBase: null,
  unitCost: null,
  unitCostNet: null,
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
  source: null,
  lineCount: 1,
  createdAt: "2026-08-19T10:00:00.000Z",
  createdBy: { id: "u1", firstName: "Ana", lastName: "Pérez" },
  confirmedAt: null,
  canceledAt: null,
  rows: [fila()],
  products: [
    {
      id: "p1",
      sku: "PAR-500",
      name: "Paracetamol",
      baseUnit: "unit",
      isComposite: false,
      tracksLots: false,
      location: null,
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
  mockedWarehouses.mockResolvedValue([buildWarehouse()]);
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
  it("la plantilla se pide para la sucursal del documento", async () => {
    mocked.downloadCountTemplate.mockResolvedValue(undefined);
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    await user.click(screen.getByRole("button", { name: /plantilla excel/i }));

    await waitFor(() => {
      expect(mocked.downloadCountTemplate).toHaveBeenCalledWith("w1", "xlsx");
    });
  });

  it("la plantilla del conteo solo existe en Excel (Carlos, 2026-09-01)", async () => {
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    expect(screen.queryByRole("button", { name: /plantilla .csv/i })).not.toBeInTheDocument();
    expect(document.getElementById("count-upload")).toHaveAttribute("accept", ".xlsx");
    // `user` se usa para mantener la firma del arnés compartido.
    void user;
  });

  /** Input `sr-only` + label, el patrón de F2-IMPORT: un `<input file>` crudo no se puede estilar. */
  it("el control de archivo está oculto detrás de su etiqueta", async () => {
    await renderCount();
    await screen.findByText("INV-000007");

    expect(screen.getByLabelText(/elegir archivo/i)).toHaveClass("sr-only");
  });

  it("subir el archivo lo manda al borrador, en base64", async () => {
    mocked.importDocumentLines.mockResolvedValue({ imported: 1, withErrors: 0, rows: [] });
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    const archivo = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "conteo.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    await user.upload(screen.getByLabelText(/elegir archivo/i), archivo);

    await waitFor(() => {
      expect(mocked.importDocumentLines).toHaveBeenCalledWith(
        "doc-1",
        expect.objectContaining({ format: "xlsx", mode: "replace" }),
      );
    });
  });

  /**
   * Carlos (2026-09-01): subir el conteo no decía nada al terminar — el
   * resumen cambiaba «solo». El éxito va en un cuadro verde con el foco
   * puesto, el mismo de importar productos y servicios.
   */
  it("al subir el conteo, el éxito se ve en un cuadro verde con el foco puesto", async () => {
    mocked.importDocumentLines.mockResolvedValue({ imported: 12, withErrors: 0, rows: [] });
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    await user.upload(
      screen.getByLabelText(/elegir archivo/i),
      new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "conteo.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );

    const listo = await screen.findByTestId("count-import-done");
    expect(listo).toHaveAttribute("role", "status");
    expect(listo).toHaveClass("bg-success-soft");
    expect(listo).toHaveTextContent("Conteo cargado: 12 filas.");
    expect(listo).toHaveFocus();
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
   * F10-BULK-06 no toca el conteo: ahí se cuenta en unidad base (decisión del
   * 2026-08-31) y su botón llega con «Contar por presentaciones» (F10-BULK-10).
   * Dos renglones del mismo queso con lote tampoco llevan el resumen por
   * producto de F10-BULK-08: es de entradas, salidas y traspasos.
   */
  it("un queso en kilos no ofrece el botón de unidad ni el resumen por producto", async () => {
    localStorage.clear();
    localStorage.setItem("sellpoint.captureUnit.kg", "gr");
    mocked.getDocument.mockResolvedValue(
      detalle({
        rows: [
          fila({ id: "l1", lineNo: 1, lotCode: "L1", counted: "2.5", difference: "0" }),
          fila({ id: "l2", lineNo: 2, lotCode: "L2", counted: "1", difference: "0" }),
        ],
        products: [
          {
            id: "p1",
            sku: "PAR-500",
            name: "Queso Oaxaca",
            baseUnit: "kg",
            isComposite: false,
            tracksLots: true,
            location: null,
            availableUnits: null,
            presentations: [],
          },
        ],
      }),
    );
    await renderCount();

    const campos = await screen.findAllByLabelText(/Contado/i);
    expect(campos[0]).toHaveValue(2.5);
    expect(screen.queryByRole("button", { name: /escribir la cantidad en/i })).toBeNull();
    expect(screen.queryByText(/renglones/)).toBeNull();
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

  /**
   * Carlos (2026-10-31): en un conteo confirmado la columna «Stock» solo traía
   * «—» y confundía; ahí lo que importa es el teórico, lo contado y la
   * diferencia. En el borrador se queda: es la previa de cómo va a quedar.
   */
  it("confirmado, ya no trae la columna «Stock» y la tabla sigue alineada", async () => {
    mocked.getDocument.mockResolvedValue(detalle({ status: "confirmed" }));
    await renderCount();

    const fila = (await screen.findByText("PAR-500")).closest("tr") as HTMLElement;
    const tabla = fila.closest("table") as HTMLElement;
    expect(within(tabla).queryByRole("columnheader", { name: "Stock" })).not.toBeInTheDocument();
    expect(within(fila).getAllByRole("cell")).toHaveLength(
      within(tabla).getAllByRole("columnheader").length,
    );
  });

  it("en borrador, la columna «Stock» sigue: es la previa", async () => {
    await renderCount();

    const tabla = (await screen.findByText("PAR-500")).closest("table") as HTMLElement;
    expect(within(tabla).getByRole("columnheader", { name: "Stock" })).toBeInTheDocument();
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
    expect(
      screen.queryByRole("button", { name: /^confirmar inventario$/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/debe aprobar este conteo/i)).toBeInTheDocument();
  });

  it("con `inventory:manage` sí se puede aprobar", async () => {
    await renderCount(["inventory:read", "inventory:movement", "inventory:manage"]);

    await screen.findByText("PAR-500");
    expect(screen.getByRole("button", { name: /^confirmar inventario$/i })).toBeEnabled();
  });

  /**
   * Carlos (2026-11-01): «Anular» y «Confirmar inventario» se quedan arriba,
   * pero confirmar solo se habilita cuando ya se subió la plantilla. En un
   * conteo las líneas solo entran subiéndola: sin líneas, no hay qué aprobar.
   */
  it("sin plantilla subida, «Confirmar inventario» está apagado y dice por qué", async () => {
    mocked.getDocument.mockResolvedValue(
      detalle({
        rows: [],
        lineCount: 0,
        countSummary: { counted: 0, matches: 0, discrepancies: 0, skipped: 0, newLots: 0 },
        summary: { lines: 0, products: 0, newLots: 0, errors: 0 },
      }),
    );
    await renderCount(["inventory:read", "inventory:movement", "inventory:manage"]);

    const boton = await screen.findByRole("button", { name: /^confirmar inventario$/i });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute("title", "Sube la plantilla para confirmar");
    expect(screen.getByRole("button", { name: /^anular$/i })).toBeInTheDocument();
    expect(screen.getByText("Ningún archivo elegido")).toBeInTheDocument();
  });

  it("con la plantilla ya subida, junto al archivo dice cuántas filas se cargaron", async () => {
    await renderCount(["inventory:read", "inventory:movement", "inventory:manage"]);

    await screen.findByText("PAR-500");
    expect(screen.getByText("Conteo subido: 1 fila")).toBeInTheDocument();
    expect(screen.queryByText("Ningún archivo elegido")).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /^confirmar inventario$/i }));
    await user.click(await screen.findByRole("button", { name: /^confirmar inventario físico$/i }));

    expect(await screen.findByText(/2 líneas cambiaron/i)).toBeInTheDocument();
  });
});

describe("subir el conteo (Carlos, 2026-09-01)", () => {
  const archivo = () =>
    new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "conteo.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

  it("el botón dice «Elegir archivo», igual que al importar catálogos", async () => {
    await renderCount();
    await screen.findByText("INV-000007");

    expect(screen.getByText("Elegir archivo")).toHaveAttribute("for", "count-upload");
  });

  it("si ninguna fila trae «contado», lo dice — no deja que «0 coinciden» lo cuente", async () => {
    mocked.importDocumentLines.mockResolvedValue({
      imported: 19,
      withErrors: 0,
      rows: [
        { row: 2, counted: null },
        { row: 3, counted: null },
      ],
    });
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    await user.upload(screen.getByLabelText(/elegir archivo/i), archivo());

    const aviso = await screen.findByTestId("count-import-no-counted");
    expect(aviso).toHaveTextContent(/contado/);
    expect(aviso).toHaveTextContent(/guardado el archivo/i);
  });

  it("con al menos una fila contada, no hay aviso", async () => {
    mocked.importDocumentLines.mockResolvedValue({
      imported: 2,
      withErrors: 0,
      rows: [
        { row: 2, counted: 0 },
        { row: 3, counted: null },
      ],
    });
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    await user.upload(screen.getByLabelText(/elegir archivo/i), archivo());

    await screen.findByTestId("count-import-done");
    expect(screen.queryByTestId("count-import-no-counted")).not.toBeInTheDocument();
  });
});

describe("el panel de captura y la cajita de «contado» (Carlos, 2026-09-01, noche)", () => {
  const archivo = () =>
    new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "conteo.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

  /**
   * Las líneas iban con `key={lineNo}`: al subir el conteo de nuevo (modo
   * «replace») las líneas nuevas traen los MISMOS números de línea, React
   * reutiliza el componente y el `useState` inicial del contado se queda con
   * el valor viejo — la cajita vacía mientras la diferencia ya dice 13.
   */
  it("tras volver a subir el conteo, la cajita muestra el contado nuevo", async () => {
    mocked.getDocument.mockResolvedValueOnce(
      detalle({ rows: [fila({ id: "line-1", counted: null, difference: null })] }),
    );
    mocked.getDocument.mockResolvedValue(
      detalle({ rows: [fila({ id: "line-9", counted: "50", difference: "13" })] }),
    );
    mocked.importDocumentLines.mockResolvedValue({ imported: 1, withErrors: 0, rows: [] });
    const { user } = await renderCount();
    await screen.findByText("INV-000007");
    expect(screen.getByLabelText(/^contado$/i)).toHaveValue(null);

    await user.upload(screen.getByLabelText(/elegir archivo/i), archivo());

    await waitFor(() => {
      expect(screen.getByLabelText(/^contado$/i)).toHaveValue(50);
    });
  });

  it("se ve como el diálogo de importar catálogos: tarjeta, pasos numerados y botones grises", async () => {
    await renderCount();
    await screen.findByText("INV-000007");

    expect(screen.getByText("Subir el conteo")).toBeInTheDocument();
    expect(screen.getByText(/^1\. Descarga la plantilla/)).toBeInTheDocument();
    expect(screen.getByText(/^2\. Llena la columna «contado»/)).toBeInTheDocument();
    // Este conteo ya trae una fila subida: junto al botón se dice cuántas.
    expect(screen.getByText("Conteo subido: 1 fila")).toBeInTheDocument();

    const elegir = screen.getByText("Elegir archivo");
    expect(elegir).not.toHaveClass("bg-primary");
    expect(elegir.className).toMatch(/border/);
    expect(screen.getByRole("button", { name: /plantilla excel/i }).className).toMatch(/border/);
  });

  it("al elegir un archivo, su nombre reemplaza a «Ningún archivo elegido»", async () => {
    mocked.importDocumentLines.mockResolvedValue({ imported: 1, withErrors: 0, rows: [] });
    const { user } = await renderCount();
    await screen.findByText("INV-000007");

    await user.upload(screen.getByLabelText(/elegir archivo/i), archivo());

    expect(await screen.findByText("conteo.xlsx")).toBeInTheDocument();
    expect(screen.queryByText("Ningún archivo elegido")).not.toBeInTheDocument();
  });
});

describe("el contado no admite negativos (Carlos, 2026-09-01, noche)", () => {
  it("la cajita de contado declara mínimo cero", async () => {
    await renderCount();
    await screen.findByText("INV-000007");

    expect(screen.getByLabelText(/^contado$/i)).toHaveAttribute("min", "0");
  });
});

/**
 * F10-BULK-10/11 — «Contar por presentaciones».
 *
 * El conteo sigue en unidad base (decisión del 2026-08-31). Lo que faltaba es
 * sumar bolsas y sueltos sin calculadora: junto al «Contado» de cada fila, un
 * botón abre el desglose —una fila por empaque y una de «Sueltos» con el botón
 * de unidad— y su total se escribe en «Contado». El desglose viaja al API, que
 * es quien calcula el contado y lo guarda con el renglón.
 */
describe("Inventario físico: contar por presentaciones (F10-BULK-10)", () => {
  const queso = (
    overrides: Partial<DocumentDetail["products"][number]> = {},
  ): DocumentDetail["products"][number] => ({
    id: "p1",
    sku: "QUE-1",
    name: "Queso Oaxaca",
    baseUnit: "kg",
    isComposite: false,
    tracksLots: false,
    location: null,
    availableUnits: null,
    presentations: [
      {
        id: "pr-kg",
        name: "Kilogramo",
        factor: "1",
        allowFractionalInput: true,
        isPurchasable: true,
        isSellable: true,
        isBase: true,
      },
      {
        id: "pr-b1",
        name: "Bolsa 1 Kg",
        factor: "1",
        allowFractionalInput: false,
        isPurchasable: true,
        isSellable: true,
        isBase: false,
      },
      {
        id: "pr-b10",
        name: "Bolsa 10 Kg",
        factor: "10",
        allowFractionalInput: false,
        isPurchasable: true,
        isSellable: true,
        isBase: false,
      },
    ],
    ...overrides,
  });

  const conteoDeQueso = (
    rowOverrides: Partial<DocumentRow> = {},
    status: "draft" | "confirmed" = "draft",
  ) =>
    detalle({
      status,
      rows: [
        fila({
          sku: "QUE-1",
          theoretical: "2.5",
          counted: null,
          difference: null,
          ...rowOverrides,
        }),
      ],
      products: [queso()],
    });

  const BOTON = /^contar por presentaciones$/i;

  beforeEach(() => {
    localStorage.clear();
  });

  it("abre una fila por empaque y una de «Sueltos», sin la presentación base", async () => {
    mocked.getDocument.mockResolvedValue(conteoDeQueso());
    const { user } = await renderCount();

    await user.click(await screen.findByRole("button", { name: BOTON }));

    const desglose = screen.getByRole("group", { name: /contar por presentaciones/i });
    expect(within(desglose).getByLabelText("Bolsa 1 Kg")).toHaveFocus();
    expect(within(desglose).getByLabelText("Bolsa 10 Kg")).toBeInTheDocument();
    expect(within(desglose).getByLabelText("Sueltos")).toBeInTheDocument();
    expect(within(desglose).queryByLabelText("Kilogramo")).toBeNull();
    // Los sueltos llevan el botón de unidad: 600 g se escriben como 600.
    expect(
      within(desglose).getByRole("button", { name: /escribir la cantidad en gramos/i }),
    ).toBeInTheDocument();
  });

  it("2 × Bolsa 1 Kg + 1 × Bolsa 10 Kg + 600 g: el total sale en kilogramos y se guarda con el renglón", async () => {
    mocked.getDocument.mockResolvedValue(conteoDeQueso());
    mocked.updateDocumentLine.mockResolvedValue({ counted: "12.6" } as never);
    const { user } = await renderCount();

    await user.click(await screen.findByRole("button", { name: BOTON }));
    const desglose = screen.getByRole("group", { name: /contar por presentaciones/i });
    await user.type(within(desglose).getByLabelText("Bolsa 1 Kg"), "2");
    await user.type(within(desglose).getByLabelText("Bolsa 10 Kg"), "1");
    await user.click(
      within(desglose).getByRole("button", { name: /escribir la cantidad en gramos/i }),
    );
    await user.type(within(desglose).getByLabelText("Sueltos"), "600");

    expect(within(desglose).getByText("Total: 12.600 kilogramos")).toBeInTheDocument();

    await user.click(within(desglose).getByRole("button", { name: /usar este total/i }));

    await waitFor(() => {
      expect(mocked.updateDocumentLine).toHaveBeenCalledWith("doc-1", "line-1", {
        countBreakdown: [
          { presentationId: "pr-b1", quantity: "2" },
          { presentationId: "pr-b10", quantity: "1" },
          { presentationId: null, quantity: "0.6" },
        ],
      });
    });
    // El total queda en «Contado» y el desglose se cierra.
    expect(await screen.findByLabelText(/^contado$/i)).toHaveValue(12.6);
    expect(screen.queryByRole("group", { name: /contar por presentaciones/i })).toBeNull();
  });

  it("el total escrito en «Contado» no se vuelve a mandar como contado tecleado", async () => {
    mocked.getDocument.mockResolvedValue(conteoDeQueso());
    mocked.updateDocumentLine.mockResolvedValue({ counted: "20" } as never);
    const { user } = await renderCount();

    await user.click(await screen.findByRole("button", { name: BOTON }));
    await user.type(screen.getByLabelText("Bolsa 10 Kg"), "2");
    await user.click(screen.getByRole("button", { name: /usar este total/i }));

    expect(await screen.findByLabelText(/^contado$/i)).toHaveValue(20);
    // Pasa el autoguardado de «Contado» (400 ms): un `counted` borraría el desglose.
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(mocked.updateDocumentLine).toHaveBeenCalledTimes(1);
    expect(mocked.updateDocumentLine).not.toHaveBeenCalledWith(
      "doc-1",
      "line-1",
      expect.objectContaining({ counted: expect.anything() }),
    );
  });

  it("respeta «Solo enteros» de cada empaque: medio bolsa no deja usar el total", async () => {
    mocked.getDocument.mockResolvedValue(conteoDeQueso());
    const { user } = await renderCount();

    await user.click(await screen.findByRole("button", { name: BOTON }));
    await user.type(screen.getByLabelText("Bolsa 10 Kg"), "1.5");

    expect(
      screen.getByText("«Bolsa 10 Kg» no se parte: usa una cantidad entera."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /usar este total/i })).toBeDisabled();
  });

  it("se usa con el teclado: Enter usa el total y Escape cierra sin guardar", async () => {
    mocked.getDocument.mockResolvedValue(conteoDeQueso());
    mocked.updateDocumentLine.mockResolvedValue({ counted: "10" } as never);
    const { user } = await renderCount();

    const boton = await screen.findByRole("button", { name: BOTON });
    await user.click(boton);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: /contar por presentaciones/i })).toBeNull();
    expect(boton).toHaveFocus();
    expect(mocked.updateDocumentLine).not.toHaveBeenCalled();

    await user.keyboard("{Enter}");
    await user.tab();
    await user.keyboard("1{Enter}");

    await waitFor(() => {
      expect(mocked.updateDocumentLine).toHaveBeenCalledWith("doc-1", "line-1", {
        countBreakdown: [{ presentationId: "pr-b10", quantity: "1" }],
      });
    });
  });

  it("al volver a abrirlo trae lo guardado, para corregir una bolsa sin teclear todo", async () => {
    mocked.getDocument.mockResolvedValue(
      conteoDeQueso({
        counted: "12.6",
        difference: "10.1",
        countBreakdown: [
          { presentationId: "pr-b1", quantity: "2", presentationName: "Bolsa 1 Kg" },
          { presentationId: "pr-b10", quantity: "1", presentationName: "Bolsa 10 Kg" },
          { presentationId: null, quantity: "0.6", presentationName: null },
        ],
      }),
    );
    const { user } = await renderCount();

    // Cerrado, el renglón ya dice cómo se contó.
    expect(await screen.findByText("2 × Bolsa 1 Kg + 1 × Bolsa 10 Kg + 600 g")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: BOTON }));
    expect(screen.getByLabelText("Bolsa 1 Kg")).toHaveValue("2");
    expect(screen.getByLabelText("Bolsa 10 Kg")).toHaveValue("1");
    expect(screen.getByLabelText("Sueltos")).toHaveValue("0.6");
    expect(screen.getByText("Total: 12.600 kilogramos")).toBeInTheDocument();
  });

  it("el conteo confirmado muestra el desglose junto a lo contado, sin el botón", async () => {
    mocked.getDocument.mockResolvedValue(
      conteoDeQueso(
        {
          counted: "12.6",
          difference: "10.1",
          countBreakdown: [
            { presentationId: "pr-b1", quantity: "2", presentationName: "Bolsa 1 Kg" },
            { presentationId: "pr-b10", quantity: "1", presentationName: "Bolsa 10 Kg" },
            { presentationId: null, quantity: "0.6", presentationName: null },
          ],
        },
        "confirmed",
      ),
    );
    await renderCount(["inventory:read", "inventory:movement", "inventory:manage"]);

    expect(await screen.findByText("2 × Bolsa 1 Kg + 1 × Bolsa 10 Kg + 600 g")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BOTON })).toBeNull();
  });

  it("un producto sin empaques no ofrece el botón: su contado se escribe directo", async () => {
    await renderCount();

    await screen.findByLabelText(/^contado$/i);
    expect(screen.queryByRole("button", { name: BOTON })).toBeNull();
  });
});
