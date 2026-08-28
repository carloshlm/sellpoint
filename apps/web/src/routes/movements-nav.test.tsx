import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
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

describe("Candados por plan en el nav (F7-WEB-07)", () => {
  it("un plan SIN movements ve el grupo con CANDADO (botón, no link) que abre el modal de planes", async () => {
    const user = demoUser(["inventory:read", "pos:quote"]);
    user.subscription = {
      ...SUBSCRIPTION_PLUS,
      planCode: "basic",
      status: "active",
      features: {
        ...SUBSCRIPTION_PLUS.features,
        movements: false,
        transfers: false,
        lots: false,
        quotes: false,
      },
    };
    useAuthStore.getState().setAuth("jwt-demo", user);
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

    // Entradas es BOTÓN (candado), no link: se VE lo que el plan no incluye.
    const candado = await screen.findByRole("button", { name: "Entradas" });
    expect(candado).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Entradas" })).not.toBeInTheDocument();
    // La cotización también queda con candado en Basic.
    expect(screen.getByRole("button", { name: "Cotización" })).toBeInTheDocument();

    // El click abre el modal de planes: el candado ES el upsell.
    const { useBillingStore } = await import("@/stores/billing.store");
    candado.click();
    expect(useBillingStore.getState().plansModalOpen).toBe(true);
  });

  it("el permiso sigue mandando: sin inventory:read no hay ni candado", async () => {
    const user = demoUser(["pos:sell"]);
    user.subscription = {
      ...SUBSCRIPTION_PLUS,
      features: { ...SUBSCRIPTION_PLUS.features, movements: false },
    };
    useAuthStore.getState().setAuth("jwt-demo", user);
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

    await screen.findByRole("navigation", { name: "Navegación principal" });
    expect(screen.queryByRole("button", { name: "Entradas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Entradas" })).not.toBeInTheDocument();
  });
});
