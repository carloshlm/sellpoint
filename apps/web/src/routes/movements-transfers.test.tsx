import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../i18n";
import type { TransferDetail, TransferRow } from "../lib/inventory/transfers-api";
import * as transfersApi from "../lib/inventory/transfers-api";
import { createQueryClient } from "../lib/query-client";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-TRANSFER-05/06/07 — la pantalla de traspasos en tránsito.
 *
 * **No captura nada.** Muestra el ESTADO del viaje: qué salió y todavía no
 * llegó, y hace cuánto. El despacho se hace desde Salidas y la recepción desde
 * Entradas — acá solo se lanza esa recepción y, si hace falta, se cancela.
 */
vi.mock("../lib/inventory/transfers-api", () => ({
  listTransfers: vi.fn(),
  getTransfer: vi.fn(),
  createReceiptDraft: vi.fn(),
  cancelTransfer: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));

const mocked = vi.mocked(transfersApi);
const mockedWarehouses = vi.mocked(warehousesApi.listWarehouses);

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

const fila = (overrides: Partial<TransferRow> = {}): TransferRow => ({
  id: "tr-1",
  documentId: "doc-1",
  folio: "SAL-000124",
  status: "in_transit",
  origin: { id: "w1", name: "Bodega Norte" },
  destination: { id: "w2", name: "Central" },
  createdAt: "2026-08-16T10:00:00.000Z",
  createdBy: { id: "u9", name: "María López" },
  lineCount: 3,
  daysInTransit: 1,
  isStale: false,
  ...overrides,
});

const detalle = (overrides: Partial<TransferDetail> = {}): TransferDetail => ({
  id: "tr-1",
  documentId: "doc-1",
  folio: "SAL-000124",
  status: "in_transit",
  origin: { id: "w1", name: "Bodega Norte" },
  destination: { id: "w2", name: "Central" },
  createdAt: "2026-08-16T10:00:00.000Z",
  createdBy: { id: "u9", name: "María López" },
  receivedAt: null,
  receivedBy: null,
  canceledAt: null,
  canceledBy: null,
  cancelReason: null,
  discrepancyNote: null,
  lines: [
    {
      id: "tl-1",
      productId: "p1",
      sku: "PAR-500",
      name: "Paracetamol",
      baseUnit: "unit",
      lot: null,
      quantitySent: "50",
      quantityReceived: null,
      difference: null,
    },
  ],
  ...overrides,
});

const pagina = (rows: TransferRow[], meta = { incomingCount: 1, outgoingCount: 0 }) => ({
  rows,
  total: rows.length,
  page: 1,
  pageSize: 20,
  meta,
});

async function renderTransfers(permissions: string[] = ["inventory:read", "inventory:movement"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/movements/transfers"] }),
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
  mocked.listTransfers.mockReset();
  mocked.getTransfer.mockReset();
  mocked.createReceiptDraft.mockReset();
  mocked.cancelTransfer.mockReset();
  mockedWarehouses.mockReset();
  mockedWarehouses.mockResolvedValue([
    { id: "w1", name: "Bodega Norte", address: null, isActive: true, deactivationBlockedBy: null },
    { id: "w2", name: "Central", address: null, isActive: true, deactivationBlockedBy: null },
  ]);
  mocked.listTransfers.mockResolvedValue(pagina([fila()]));
  mocked.getTransfer.mockResolvedValue(detalle());
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Traspasos en tránsito (F3-TRANSFER-05)", () => {
  it("arranca en «pendientes de recibir» y muestra el folio del despacho", async () => {
    await renderTransfers();

    expect(await screen.findByText("SAL-000124")).toBeInTheDocument();
    expect(mocked.listTransfers).toHaveBeenCalledWith(
      expect.objectContaining({ direction: "incoming" }),
    );
  });

  it("cambiar de tab cambia la dirección del request", async () => {
    const { user } = await renderTransfers();
    await screen.findByText("SAL-000124");

    await user.click(screen.getByRole("tab", { name: /pendientes de enviar/i }));

    await waitFor(() => {
      expect(mocked.listTransfers).toHaveBeenCalledWith(
        expect.objectContaining({ direction: "outgoing" }),
      );
    });
  });

  it("los contadores salen de `meta`, no de contar filas", async () => {
    // 1 fila en pantalla pero 7 entrantes en total: si los contadores se
    // calcularan contando la página, dirían 1 y mentirían con la paginación.
    mocked.listTransfers.mockResolvedValue(
      pagina([fila()], { incomingCount: 7, outgoingCount: 4 }),
    );
    await renderTransfers();

    const entrantes = await screen.findByRole("tab", { name: /pendientes de recibir/i });
    expect(entrantes).toHaveTextContent("7");
    expect(screen.getByRole("tab", { name: /pendientes de enviar/i })).toHaveTextContent("4");
  });

  /** El badge sale del DATO `isStale`, no de comparar días en la pantalla. */
  it("un traspaso demorado se marca", async () => {
    mocked.listTransfers.mockResolvedValue(pagina([fila({ daysInTransit: 8, isStale: true })]));
    await renderTransfers();

    const filaTr = (await screen.findByText("SAL-000124")).closest("tr") as HTMLElement;

    expect(within(filaTr).getByTestId("stale-badge")).toBeInTheDocument();
  });

  it("uno reciente no lleva badge", async () => {
    await renderTransfers();

    const filaTr = (await screen.findByText("SAL-000124")).closest("tr") as HTMLElement;

    expect(within(filaTr).queryByTestId("stale-badge")).not.toBeInTheDocument();
  });

  it("el folio enlaza al documento de despacho", async () => {
    await renderTransfers();

    const enlace = await screen.findByRole("link", { name: "SAL-000124" });

    expect(enlace).toHaveAttribute("href", "/movements/documents/doc-1");
  });

  it("filtrar por destino manda el filtro al server", async () => {
    const { user } = await renderTransfers();
    await screen.findByText("SAL-000124");

    await user.selectOptions(screen.getByLabelText(/destino/i), "w2");

    await waitFor(() => {
      expect(mocked.listTransfers).toHaveBeenCalledWith(
        expect.objectContaining({ destinationWarehouseId: "w2" }),
      );
    });
  });

  it("sin nada en tránsito, cada tab dice lo suyo", async () => {
    mocked.listTransfers.mockResolvedValue(pagina([], { incomingCount: 0, outgoingCount: 0 }));
    await renderTransfers();

    expect(await screen.findByText(/no hay traspasos/i)).toBeInTheDocument();
  });
});

describe("Lanzar la recepción (F3-TRANSFER-06)", () => {
  it("el diálogo NO captura cantidades: solo confirma la intención", async () => {
    const { user } = await renderTransfers();
    await screen.findByText("SAL-000124");

    await user.click(screen.getByRole("button", { name: /recibir/i }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/SAL-000124/)).toBeInTheDocument();
    expect(within(dialogo).getByText(/Bodega Norte/)).toBeInTheDocument();
    // Nada de inputs de cantidad: el conteo ocurre en la pantalla del
    // documento, que ya tiene esa tabla. Una segunda copia divergiría.
    expect(within(dialogo).queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("«Crear entrada» postea el borrador y navega a la pantalla del documento", async () => {
    mocked.createReceiptDraft.mockResolvedValue({ id: "ent-9", folio: "ENT-000043" });
    const { user, router } = await renderTransfers();
    await screen.findByText("SAL-000124");

    await user.click(screen.getByRole("button", { name: /recibir/i }));
    await user.click(await screen.findByRole("button", { name: /crear entrada/i }));

    await waitFor(() => {
      expect(mocked.createReceiptDraft).toHaveBeenCalledWith("tr-1");
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/movements/documents/ent-9");
    });
  });

  /** Si otro lo cerró mientras tanto, se avisa en vez de dejar un 409 mudo. */
  it("un 409 se explica y no navega", async () => {
    mocked.createReceiptDraft.mockRejectedValue({ statusCode: 409, message: "ya cerrado" });
    const { user, router } = await renderTransfers();
    await screen.findByText("SAL-000124");

    await user.click(screen.getByRole("button", { name: /recibir/i }));
    await user.click(await screen.findByRole("button", { name: /crear entrada/i }));

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/movements/transfers");
  });

  it("sin `inventory:movement` no se puede lanzar la recepción", async () => {
    await renderTransfers(["inventory:read"]);

    await screen.findByText("SAL-000124");
    expect(screen.queryByRole("button", { name: /recibir/i })).not.toBeInTheDocument();
  });
});

describe("Cancelar un traspaso (F3-TRANSFER-07)", () => {
  const conManage = ["inventory:read", "inventory:movement", "inventory:manage"];

  it("la acción solo existe con `inventory:manage`", async () => {
    await renderTransfers(conManage);
    expect(await screen.findByRole("button", { name: /cancelar traspaso/i })).toBeInTheDocument();
  });

  it("un operario con `inventory:movement` NO la ve", async () => {
    await renderTransfers(["inventory:read", "inventory:movement"]);

    await screen.findByText("SAL-000124");
    expect(screen.queryByRole("button", { name: /cancelar traspaso/i })).not.toBeInTheDocument();
  });

  /**
   * La leyenda no es un adorno: es lo único que le dice a quien cancela que el
   * saldo NO vuelve solo, y qué hacer si la mercancía reaparece.
   */
  it("el diálogo avisa que el stock no vuelve al origen", async () => {
    const { user } = await renderTransfers(conManage);
    await screen.findByText("SAL-000124");

    await user.click(screen.getByRole("button", { name: /cancelar traspaso/i }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByText(/no vuelve al origen/i)).toBeInTheDocument();
    expect(within(dialogo).getByText(/motivo Ajuste/i)).toBeInTheDocument();
  });

  it("sin justificación el confirmar queda deshabilitado", async () => {
    const { user } = await renderTransfers(conManage);
    await screen.findByText("SAL-000124");

    await user.click(screen.getByRole("button", { name: /cancelar traspaso/i }));

    const dialogo = await screen.findByRole("alertdialog");
    expect(within(dialogo).getByRole("button", { name: /^cancelar traspaso$/i })).toBeDisabled();
  });

  it("con justificación, el request la lleva", async () => {
    mocked.cancelTransfer.mockResolvedValue(undefined);
    const { user } = await renderTransfers(conManage);
    await screen.findByText("SAL-000124");

    await user.click(screen.getByRole("button", { name: /cancelar traspaso/i }));
    const dialogo = await screen.findByRole("alertdialog");
    await user.type(
      within(dialogo).getByLabelText(/justificación/i),
      "El camión nunca salió del patio",
    );
    await user.click(within(dialogo).getByRole("button", { name: /^cancelar traspaso$/i }));

    await waitFor(() => {
      expect(mocked.cancelTransfer).toHaveBeenCalledWith("tr-1", "El camión nunca salió del patio");
    });
  });
});
