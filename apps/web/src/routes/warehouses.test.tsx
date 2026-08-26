import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  deleteWarehouse: vi.fn(),
}));

const mockedApi = vi.mocked(warehousesApi);

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

/**
 * F3-GUARDS-03, revisado (Carlos, 2026-08-25): el botón bloqueado ya NO se
 * deshabilita — deshabilitado tenía `pointer-events: none` y el tooltip con
 * el motivo no podía aparecer nunca: parecía un botón muerto. Ahora el
 * `title` avisa al hover y el 409 del server cuenta el mismo motivo al clic.
 */
describe("Almacenes: la guarda se ve antes del clic (F3-GUARDS-03)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
  });

  it("con saldo, el botón sigue VIVO y el title dice por qué se va a rechazar", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "stock" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(botonEstado("Central")).toBeEnabled());
    expect(botonEstado("Central").title).toContain("existencias");
  });

  it("con traspasos en camino, el motivo es OTRO", async () => {
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "transfers_in_transit" }),
    ]);
    await renderWarehouses();

    await waitFor(() => expect(botonEstado("Central")).toBeEnabled());
    // Si los dos motivos dijeran lo mismo, el usuario no sabría qué hacer:
    // vaciar el almacén no destraba un traspaso en camino.
    expect(botonEstado("Central").title).toContain("camino");
  });

  it("el clic sobre uno bloqueado deja que el 409 del server explique", async () => {
    const user = userEvent.setup();
    mockedApi.listWarehouses.mockResolvedValue([
      almacen({ id: "w1", name: "Central", deactivationBlockedBy: "stock" }),
    ]);
    mockedApi.updateWarehouse.mockRejectedValue({
      statusCode: 409,
      message: "Este almacén todavía tiene existencias: muévelas antes de desactivarlo.",
    });
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(botonEstado("Central"));

    expect(await screen.findByTestId("warehouses-error")).toHaveTextContent("existencias");
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

/**
 * Eliminar un almacén (Carlos, 2026-08-25): solo uno que nunca operó. El 409
 * del API (has_history) se muestra — la salida no destructiva es desactivar.
 */
describe("Eliminar un almacén (2026-08-25)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().clearAuth();
    mockedApi.listWarehouses.mockResolvedValue([almacen({ id: "w1", name: "Central" })]);
  });

  it("el primer clic PREGUNTA nombrando el almacén; nada viaja todavía", async () => {
    const user = userEvent.setup();
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));

    expect(await screen.findByTestId("delete-warehouse-dialog")).toHaveTextContent("Central");
    expect(mockedApi.deleteWarehouse).not.toHaveBeenCalled();
  });

  it("recién al confirmar se borra", async () => {
    const user = userEvent.setup();
    mockedApi.deleteWarehouse.mockResolvedValue(undefined);
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar almacén" }));

    await waitFor(() => expect(mockedApi.deleteWarehouse.mock.calls[0]?.[0]).toBe("w1"));
  });

  it("el 409 por historia se muestra y el diálogo se cierra", async () => {
    const user = userEvent.setup();
    mockedApi.deleteWarehouse.mockRejectedValue({
      statusCode: 409,
      message: "Este almacén ya tiene operaciones registradas: no se puede eliminar.",
    });
    await renderWarehouses();
    await screen.findByText("Central");

    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    await user.click(await screen.findByRole("button", { name: "Eliminar almacén" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("operaciones registradas");
    expect(screen.queryByTestId("delete-warehouse-dialog")).not.toBeInTheDocument();
  });
});
