import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import * as inventoryApi from "../lib/inventory/api";
import type { ExpiringRow } from "../lib/inventory/types";
import { createQueryClient } from "../lib/query-client";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-LOTS-03 — la pantalla de "próximos a vencer".
 *
 * Sin cron y sin notificaciones: es una CONSULTA que se hace al abrirla. Lo YA
 * vencido aparece igual que lo que está por vencer —sigue en el estante y hay
 * que sacarlo—, y por eso se marca en vez de esconderse.
 */
vi.mock("../lib/inventory/api", () => ({
  listExpiring: vi.fn(),
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
  downloadExpiring: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));

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
    monthlySalesGoal: null,
  },
});

const fila = (overrides: Partial<ExpiringRow> = {}): ExpiringRow => ({
  productId: "p1",
  sku: "YOG-1",
  name: "Yogur natural",
  lot: { id: "l1", lotCode: "st10", expiresAt: "2026-07-01T00:00:00.000Z" },
  warehouse: { id: "w1", name: "Central" },
  location: "A-1",
  quantity: "4",
  daysLeft: 10,
  expired: false,
  ...overrides,
});

async function renderExpiring(permissions: string[] = ["inventory:read", "inventory:movement"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/movements/expiring"] }),
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
  mocked.listExpiring.mockResolvedValue([fila()]);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Próximos a vencer (F3-LOTS-03)", () => {
  /**
   * F5-EXP-03 — exportar desde la pantalla que ya se está viendo.
   *
   * No hay pantalla nueva en Reportes: la tarjeta del hub enlaza acá. Y el
   * permiso sigue siendo `inventory:read`, porque el archivo es la MISMA
   * lectura en otro formato.
   */
  describe("el export (F5-EXP-03)", () => {
    it("exporta con el plazo que está elegido", async () => {
      const { user } = await renderExpiring();
      await screen.findByText("YOG-1");

      await user.click(screen.getByRole("button", { name: "7 días" }));
      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() => expect(mocked.downloadExpiring).toHaveBeenCalledWith({ days: 7 }));
    });

    /**
     * ⚠ Si la descarga falla, SE DICE. Una promesa rechazada que nadie atrapa
     * deja a la persona esperando un archivo que no va a llegar —y en CI
     * aparece como «unhandled error», que fue justo como se descubrió
     * (2026-08-24)—.
     */
    it("si la descarga falla, lo dice en vez de quedarse callada", async () => {
      mocked.downloadExpiring.mockRejectedValue(new Error("500"));
      const { user } = await renderExpiring();
      await screen.findByText("YOG-1");

      await user.click(screen.getByRole("button", { name: /exportar/i }));

      expect(await screen.findByRole("alert")).toBeInTheDocument();
    });

    /**
     * El archivo baja lo MISMO que la pantalla muestra. Si exportara siempre
     * los 30 días por defecto, quien filtró a 7 abriría un Excel con cosas
     * que no había pedido y no tendría cómo saber por qué.
     */
    it("con el plazo por defecto exporta 30 días", async () => {
      const { user } = await renderExpiring();
      await screen.findByText("YOG-1");

      await user.click(screen.getByRole("button", { name: /exportar/i }));

      await waitFor(() => expect(mocked.downloadExpiring).toHaveBeenCalledWith({ days: 30 }));
    });
  });

  it("pide 30 días por defecto y muestra el lote con su caducidad", async () => {
    await renderExpiring();

    expect(await screen.findByText("YOG-1")).toBeInTheDocument();
    expect(screen.getByText("st10")).toBeInTheDocument();
    // Fecha de CALENDARIO: el 1 de julio se ve como 01/07, no como 30/06.
    expect(screen.getByText("01/07/2026")).toBeInTheDocument();
    expect(mocked.listExpiring).toHaveBeenCalledWith(expect.objectContaining({ days: 30 }));
  });

  it("cambiar el filtro a 7 días vuelve a consultar", async () => {
    const { user } = await renderExpiring();
    await screen.findByText("YOG-1");

    await user.click(screen.getByRole("button", { name: "7 días" }));

    await waitFor(() => {
      expect(mocked.listExpiring).toHaveBeenCalledWith(expect.objectContaining({ days: 7 }));
    });
  });

  /**
   * Lo vencido no se esconde: es lo MÁS urgente. Y se distingue por dato
   * (`expired`), no por el signo de un número que hay que interpretar.
   */
  it("lo ya vencido se marca", async () => {
    mocked.listExpiring.mockResolvedValue([
      fila({
        lot: { id: "l9", lotCode: "viejo", expiresAt: "2026-06-01T00:00:00.000Z" },
        daysLeft: -12,
        expired: true,
      }),
    ]);
    await renderExpiring();

    const filaVencida = (await screen.findByText("viejo")).closest("tr") as HTMLElement;

    expect(within(filaVencida).getByText(/vencido/i)).toBeInTheDocument();
  });

  it("lo que todavía no vence dice cuántos días le quedan", async () => {
    await renderExpiring();

    const filaProducto = (await screen.findByText("st10")).closest("tr") as HTMLElement;

    expect(within(filaProducto).getByText(/10 días/i)).toBeInTheDocument();
  });

  it("sin nada por vencer muestra un estado vacío, no una tabla en blanco", async () => {
    mocked.listExpiring.mockResolvedValue([]);
    await renderExpiring();

    expect(await screen.findByText(/nada por vencer/i)).toBeInTheDocument();
  });

  /**
   * El botón crea la Salida con motivo `expired` en el almacén donde ESTÁ el
   * lote: dar salida por caducado desde otro almacén no tendría sentido.
   */
  it("«Dar salida por caducado» crea la salida en el almacén del lote", async () => {
    mocked.createDocument.mockResolvedValue({
      id: "doc-9",
      folio: "SAL-000200",
      type: "exit",
      status: "draft",
      warehouse: { id: "w1", name: "Central" },
      reasonCode: null,
      reference: null,
      lineCount: 0,
      createdAt: "2026-08-18T00:00:00.000Z",
      createdBy: null,
      confirmedAt: null,
    });
    mocked.updateDocumentHeader.mockResolvedValue({} as never);
    mocked.addDocumentLine.mockResolvedValue({});
    const { user } = await renderExpiring();
    await screen.findByText("YOG-1");

    await user.click(screen.getByRole("button", { name: /dar salida/i }));

    await waitFor(() => {
      expect(mocked.createDocument).toHaveBeenCalledWith({ type: "exit", warehouseId: "w1" });
    });
    // El motivo y la línea van precargados: quien llega acá ya sabe qué va a
    // sacar, y volver a elegirlo sería pedirle el dato dos veces.
    await waitFor(() => {
      expect(mocked.updateDocumentHeader).toHaveBeenCalledWith(
        "doc-9",
        expect.objectContaining({ reasonCode: "expired" }),
      );
      expect(mocked.addDocumentLine).toHaveBeenCalledWith(
        "doc-9",
        expect.objectContaining({ productId: "p1", lotCode: "st10", quantity: 4 }),
      );
    });
  });

  it("sin `inventory:movement` se ve pero no se puede dar salida", async () => {
    await renderExpiring(["inventory:read"]);

    await screen.findByText("YOG-1");
    expect(screen.queryByRole("button", { name: /dar salida/i })).not.toBeInTheDocument();
  });
});
