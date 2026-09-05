import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { createI18n } from "../i18n";
import * as inventoryApi from "../lib/inventory/api";
import type { ExpiringRow } from "../lib/inventory/types";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-LOTS-03 — la tarjeta de "próximos a vencer" en el dashboard.
 *
 * **Solo aparece si hay algo que avisar.** El tablero la pedía condicionada a
 * que el tenant tuviera productos con `tracks_lots`; se condiciona a que HAYA
 * filas por vencer, que es más estricto y no necesita endpoint nuevo: un
 * negocio sin lotes nunca tiene filas, y uno con lotes pero nada por vencer
 * tampoco necesita una tarjeta que diga "0".
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
}));

const mocked = vi.mocked(inventoryApi);

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
    posShowsStock: true,
    monthlySalesGoal: null,
  },
});

const fila = (overrides: Partial<ExpiringRow> = {}): ExpiringRow => ({
  productId: "p1",
  sku: "YOG-1",
  name: "Yogur natural",
  lot: { id: "l1", lotCode: "st10", expiresAt: "2026-07-01T00:00:00.000Z" },
  warehouse: { id: "w1", name: "Central" },
  location: "",
  quantity: "4",
  daysLeft: 10,
  expired: false,
  ...overrides,
});

async function renderDashboard(permissions: string[] = ["inventory:read"]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/dashboard"] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mocked.listExpiring.mockReset();
  mocked.listExpiring.mockResolvedValue([]);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Tarjeta de próximos a vencer (F3-LOTS-03)", () => {
  it("con lotes por vencer, muestra el conteo, las filas urgentes y el enlace", async () => {
    mocked.listExpiring.mockResolvedValue([
      fila(),
      fila({
        productId: "p2",
        name: "Leche entera",
        lot: { id: "l2", lotCode: "st20", expiresAt: "2026-07-05T00:00:00.000Z" },
        daysLeft: 3,
      }),
    ]);

    await renderDashboard();

    // Por testid y no por nombre accesible: el NAV lateral tiene un enlace con
    // exactamente el mismo texto, y buscar por nombre agarraba ese.
    const tarjeta = await screen.findByTestId("expiring-card");
    expect(tarjeta).toHaveTextContent("2");
    // Las filas cuentan QUÉ vence: producto, lote y el semáforo de días —
    // el más urgente primero.
    expect(tarjeta).toHaveTextContent("Leche entera");
    expect(tarjeta).toHaveTextContent("st20");
    const urgente = within(tarjeta).getByText("3 días");
    expect(urgente).toHaveClass("text-destructive");
    const holgado = within(tarjeta).getByText("10 días");
    expect(holgado).toHaveClass("text-warning");
    // El orden es por urgencia: la leche (3 días) antes que el yogur (10).
    expect(tarjeta.textContent?.indexOf("Leche")).toBeLessThan(
      tarjeta.textContent?.indexOf("Yogur") ?? -1,
    );
    expect(within(tarjeta).getByRole("link")).toHaveAttribute("href", "/movements/expiring");
    // Las filas viven en una caja deslizable: en un celular no caben y sin
    // scroll se cortaban en el borde de la tarjeta.
    expect(within(tarjeta).getByTestId("scrollable-list")).toBeInTheDocument();
  });

  it("un lote VENCIDO dice «Vencido», no un número negativo de días", async () => {
    mocked.listExpiring.mockResolvedValue([fila({ daysLeft: -2, expired: true })]);

    await renderDashboard();

    const tarjeta = await screen.findByTestId("expiring-card");
    expect(within(tarjeta).getByText("Vencido")).toHaveClass("text-destructive");
    expect(tarjeta).not.toHaveTextContent("-2");
  });

  it("con más de tres filas, muestra las 3 más urgentes y el conteo dice el total", async () => {
    mocked.listExpiring.mockResolvedValue([
      fila({ daysLeft: 10 }),
      fila({
        productId: "p2",
        name: "B",
        lot: { id: "l2", lotCode: "b", expiresAt: "x" },
        daysLeft: 2,
      }),
      fila({
        productId: "p3",
        name: "C",
        lot: { id: "l3", lotCode: "c", expiresAt: "x" },
        daysLeft: 5,
      }),
      fila({
        productId: "p4",
        name: "D",
        lot: { id: "l4", lotCode: "d", expiresAt: "x" },
        daysLeft: 20,
      }),
    ]);

    await renderDashboard();

    const tarjeta = await screen.findByTestId("expiring-card");
    expect(tarjeta).toHaveTextContent("4");
    expect(within(tarjeta).queryByText("D")).not.toBeInTheDocument();
    expect(within(tarjeta).getByText("B")).toBeInTheDocument();
  });

  /**
   * Un negocio que no maneja lotes nunca tiene filas: la tarjeta simplemente
   * no existe para él. Mostrarle "0 próximos a vencer" sería ruido sobre algo
   * que no usa.
   */
  it("sin nada por vencer, la tarjeta no se renderiza", async () => {
    await renderDashboard();

    await screen.findByTestId("dashboard-title");
    expect(screen.queryByTestId("expiring-card")).not.toBeInTheDocument();
  });

  /** Sin permiso de inventario no se consulta siquiera. */
  it("sin `inventory:read` no se pide nada ni se muestra tarjeta", async () => {
    mocked.listExpiring.mockResolvedValue([fila()]);

    await renderDashboard([]);

    await screen.findByTestId("dashboard-title");
    expect(screen.queryByTestId("expiring-card")).not.toBeInTheDocument();
    expect(mocked.listExpiring).not.toHaveBeenCalled();
  });
});
