import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "../i18n";
import { createQueryClient } from "../lib/query-client";
import { routeTree } from "../routeTree.gen";
import { type AuthUser, useAuthStore } from "../stores/auth.store";

/**
 * F3-NAV-02 — el grupo «Movimientos» del menú.
 *
 * Los cinco listados se ven con `inventory:read`: quien AUDITA tiene que poder
 * mirar sin poder mover. El botón de crear, que exige `inventory:movement`,
 * vive dentro de cada pantalla y no en el menú.
 *
 * Mismo arnés que el resto: routeTree REAL y `createQueryClient()` — nunca un
 * `new QueryClient()` por render (C1 de f1-web-auth).
 */
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

async function renderConPermisos(permissions: string[]) {
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

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Grupo de navegación «Movimientos» (F3-NAV-02)", () => {
  it("con `inventory:read` aparecen los cuatro listados", async () => {
    await renderConPermisos(["inventory:read"]);

    for (const label of ["Entradas", "Salidas", "Traspasos", "Inventario"]) {
      expect(await screen.findByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  /**
   * El permiso de LEER inventario alcanza para ver el menú: si exigiéramos
   * `:movement`, un Viewer no podría auditar un movimiento que ya pasó.
   */
  it("sin `inventory:read` el grupo no existe", async () => {
    await renderConPermisos(["products:read"]);

    expect(screen.queryByRole("link", { name: "Entradas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Traspasos" })).not.toBeInTheDocument();
  });

  it("el grupo se anuncia con su nombre para lectores de pantalla", async () => {
    await renderConPermisos(["inventory:read"]);

    expect(await screen.findByRole("group", { name: "Movimientos" })).toBeInTheDocument();
  });
});
