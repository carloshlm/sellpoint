import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { createI18n } from "../i18n";
import { createQueryClient } from "../lib/query-client";
import * as warehousesApi from "../lib/warehouses/api";
import { routeTree } from "../routeTree.gen";

/**
 * F3-GUARDS-03. El criterio del módulo: si el API tiene una guarda, la UI la
 * muestra ANTES del clic. Chocar con el 409 es el peor final posible — el
 * usuario ya se convenció de que iba a poder.
 */
vi.mock("../lib/warehouses/api", () => ({
  listWarehouses: vi.fn(),
  createWarehouse: vi.fn(),
  updateWarehouse: vi.fn(),
}));

const mockedApi = vi.mocked(warehousesApi);

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
    phone: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
  },
});

const almacen = (over: Partial<warehousesApi.Warehouse>): warehousesApi.Warehouse => ({
  id: "w1",
  name: "Central",
  address: null,
  isActive: true,
  deactivationBlockedBy: null,
  ...over,
});

async function renderWarehouses() {
  useAuthStore.getState().setAuth("jwt", demoUser(["warehouses:read", "warehouses:manage"]));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/warehouses"] }),
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

/** El botón de desactivar/reactivar de una fila. */
function botonEstado(nombre: string) {
  const fila = screen.getByText(nombre).closest("tr");
  if (!fila) throw new Error(`no encontré la fila de ${nombre}`);
  const boton = Array.from(fila.querySelectorAll("button")).find(
    (b) => b.textContent === "Desactivar" || b.textContent === "Reactivar",
  );
  if (!boton) throw new Error(`no encontré el botón de estado de ${nombre}`);
  return boton;
}

describe("Almacenes: la guarda se ve antes del clic (F3-GUARDS-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
  });

  it("con saldo, el botón queda deshabilitado y dice por qué", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "stock" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(botonEstado("Central")).toBeDisabled());
    expect(botonEstado("Central").title).toContain("existencias");
  });

  it("con traspasos en camino, el motivo es OTRO", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "transfers_in_transit" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(botonEstado("Central")).toBeDisabled());
    // Si los dos motivos dijeran lo mismo, el usuario no sabría qué hacer:
    // vaciar el almacén no destraba un traspaso en camino.
    expect(botonEstado("Central").title).toContain("camino");
  });

  it("sin bloqueo, el botón funciona y no lleva title", async () => {
    mockedApi.listWarehouses.mockResolvedValue([almacen({ id: "w1", name: "Central" })]);
    await renderWarehouses();

    await waitFor(() => expect(screen.getByText("Central")).toBeInTheDocument());
    expect(botonEstado("Central")).toBeEnabled();
    expect(botonEstado("Central").title).toBe("");
  });

  /**
   * Uno ya inactivo trae `deactivationBlockedBy: null` desde el API, pero
   * aunque llegara con motivo, reactivar nunca se bloquea: la guarda solo
   * corre al pasar de activo a inactivo.
   */
  it("reactivar nunca se bloquea", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", isActive: false, deactivationBlockedBy: "stock" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(screen.getByText("Central")).toBeInTheDocument());
    expect(botonEstado("Central")).toBeEnabled();
  });
});
