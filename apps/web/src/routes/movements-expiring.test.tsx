import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { buildAuthUser } from "@/test/auth-fixture";
import { expectRowActionsColumn } from "@/test/row-actions";
import { buildWarehouse } from "@/test/warehouse-fixture";
import { summarizeExpiringValue } from "../components/inventory/expiring-list";
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
  printDocumentPdf: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  addDocumentLine: vi.fn(),
  importDocumentLines: vi.fn(),
  downloadExpiring: vi.fn(),
}));
vi.mock("../lib/warehouses/api", () => ({ listWarehouses: vi.fn() }));

const mocked = vi.mocked(inventoryApi);
const mockedWarehouses = vi.mocked(warehousesApi.listWarehouses);

const demoUser = (permissions: string[]): AuthUser => buildAuthUser({ permissions });

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
  mockedWarehouses.mockResolvedValue([buildWarehouse()]);
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

  // Carlos (2026-11-01): toda columna de acciones lleva su título.
  it("la última columna se titula «Acciones» y la salida va en ella", async () => {
    await renderExpiring();

    const [salida] = await screen.findAllByRole("button", { name: "Dar salida por caducado" });
    expectRowActionsColumn(salida as HTMLElement);
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
   * Carlos (2026-09-15): «Vencidos» es su propio filtro y va PRIMERO, delante
   * de los plazos. Al entrar sigue mandando 30 días.
   */
  it("«Vencidos» va primero y pide solo lo vencido, y el export baja lo mismo", async () => {
    const { user } = await renderExpiring();
    await screen.findByText("YOG-1");

    const filtros = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      // Exacto: el aviso de la prueba del plan también dice «días».
      .filter((texto) => texto !== null && /^(Vencidos|\d+ días)$/.test(texto));
    expect(filtros).toEqual(["Vencidos", "7 días", "30 días", "90 días"]);

    await user.click(screen.getByRole("button", { name: "Vencidos" }));

    await waitFor(() => {
      expect(mocked.listExpiring).toHaveBeenCalledWith({ days: 0, onlyExpired: true });
    });
    await user.click(screen.getByRole("button", { name: /exportar/i }));
    await waitFor(() => {
      expect(mocked.downloadExpiring).toHaveBeenCalledWith({ days: 0, onlyExpired: true });
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
   * El botón crea la Salida con motivo `expired` en la sucursal donde ESTÁ el
   * lote: dar salida por caducado desde otra sucursal no tendría sentido.
   */
  it("«Dar salida por caducado» crea la salida en la sucursal del lote", async () => {
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
      canceledAt: null,
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

  /**
   * F10-KPI-10 — es donde el dueño decide qué poner al frente o en promoción,
   * y lo decide por dinero, no por piezas. El valor es dinero: solo con
   * `reports:read`.
   */
  describe("cuánto vale lo que vence (F10-KPI-10)", () => {
    const CON_DINERO = ["inventory:read", "inventory:movement", "reports:read"];
    const otra = (overrides: Partial<ExpiringRow>) =>
      fila({
        productId: "p2",
        sku: "LEC-1",
        name: "Leche entera",
        lot: { id: "l2", lotCode: "st20", expiresAt: "2026-07-05T00:00:00.000Z" },
        ...overrides,
      });

    it("con `reports:read` se ven la columna «Valor» y el total del plazo", async () => {
      mocked.listExpiring.mockResolvedValue([
        fila({ unitCost: "8.00", value: "32.00" }),
        otra({ unitCost: "3.52", value: "10.55" }),
      ]);
      await renderExpiring(CON_DINERO);

      const filaYogur = (await screen.findByText("YOG-1")).closest("tr") as HTMLElement;
      expect(screen.getByRole("columnheader", { name: "Valor" })).toBeInTheDocument();
      expect(within(filaYogur).getByText("$32.00")).toHaveClass("text-right", "tabular-nums");
      expect(
        screen.getByText("$42.55 al costo en los próximos 30 días", { exact: false }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/sin contar/)).not.toBeInTheDocument();
      // La columna nueva va antes de las acciones: «Acciones» sigue siendo la última.
      const [salida] = screen.getAllByRole("button", { name: "Dar salida por caducado" });
      expectRowActionsColumn(salida as HTMLElement);
    });

    it("el total dice el plazo que está elegido, y «ya vencido» con Vencidos", async () => {
      mocked.listExpiring.mockResolvedValue([fila({ unitCost: "8.00", value: "32.00" })]);
      const { user } = await renderExpiring(CON_DINERO);
      await screen.findByText("YOG-1");

      await user.click(screen.getByRole("button", { name: "7 días" }));
      expect(
        await screen.findByText("$32.00 al costo en los próximos 7 días", { exact: false }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Vencidos" }));
      expect(
        await screen.findByText("$32.00 al costo, ya vencido", { exact: false }),
      ).toBeInTheDocument();
    });

    /**
     * Una fila sin costo dice «—»: no suma ni finge un cero. Y el total
     * avisa cuántos PRODUCTOS se quedaron fuera (la leche sale en dos lotes y
     * cuenta una vez).
     */
    it("una fila sin costo dice «—», no suma, y el total avisa cuántos productos no cuentan", async () => {
      mocked.listExpiring.mockResolvedValue([
        fila({ unitCost: "8.00", value: "32.00" }),
        otra({ unitCost: null, value: null }),
        otra({
          lot: { id: "l3", lotCode: "st21", expiresAt: "2026-07-06T00:00:00.000Z" },
          unitCost: null,
          value: null,
        }),
      ]);
      await renderExpiring(CON_DINERO);

      const filaLeche = (await screen.findByText("st20")).closest("tr") as HTMLElement;
      expect(within(filaLeche).getByText("—")).toBeInTheDocument();
      expect(within(filaLeche).queryByText(/\$0/)).not.toBeInTheDocument();
      expect(
        screen.getByText("$32.00 al costo en los próximos 30 días", { exact: false }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("sin contar 1 producto sin costo", { exact: false }),
      ).toBeInTheDocument();
    });

    it("si ninguna fila tiene costo, no hay un total en $0.00", async () => {
      mocked.listExpiring.mockResolvedValue([fila({ unitCost: null, value: null })]);
      await renderExpiring(CON_DINERO);

      const filaYogur = (await screen.findByText("YOG-1")).closest("tr") as HTMLElement;
      expect(within(filaYogur).getByText("—")).toBeInTheDocument();
      expect(screen.queryByText(/al costo/)).not.toBeInTheDocument();
      expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
    });

    it("sin `reports:read` no hay columna ni total, aunque llegara el valor", async () => {
      mocked.listExpiring.mockResolvedValue([fila({ unitCost: "8.00", value: "32.00" })]);
      await renderExpiring(["inventory:read", "inventory:movement"]);

      await screen.findByText("YOG-1");
      expect(screen.queryByRole("columnheader", { name: "Valor" })).not.toBeInTheDocument();
      expect(screen.queryByText(/al costo/)).not.toBeInTheDocument();
      expect(screen.queryByText("$32.00")).not.toBeInTheDocument();
    });

    it("con un API anterior (sin los campos) la pantalla queda como hoy", async () => {
      await renderExpiring(CON_DINERO);

      await screen.findByText("YOG-1");
      expect(screen.queryByRole("columnheader", { name: "Valor" })).not.toBeInTheDocument();
      expect(screen.queryByText(/al costo/)).not.toBeInTheDocument();
    });

    /**
     * El total se suma en centavos ENTEROS. Con flotantes, 0.57 + 1.15 da
     * 1.7199999999999998, y en centavos 56.99999999999999 + 114.99999999999999:
     * la pantalla lo redondea y no se nota, pero el número ya está mal.
     */
    it("el total se suma en centavos enteros, nunca con flotantes", () => {
      const resumen = summarizeExpiringValue([
        fila({ value: "0.57" }),
        otra({ value: "1.15" }),
        fila({ productId: "p3", value: "0.07" }),
      ]);

      expect(resumen).toEqual({ totalCents: 179, uncostedProducts: 0 });
    });
  });
});
