import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

/**
 * F9-MOD-08 — el grupo de menú de un módulo avanzado.
 *
 * Se OCULTA cuando el negocio no lo tiene (no lleva candado: el candado abre
 * el modal de planes, y el modal no vende módulos — se pactan uno a uno desde
 * el backoffice). Y aun con el módulo, cada link se gatea por SU permiso,
 * como el resto del nav.
 */
const demoUser = (
  modules: AuthUser["subscription"]["modules"],
  permissions: string[],
): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: { ...SUBSCRIPTION_PLUS, modules },
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

async function renderCon(modules: AuthUser["subscription"]["modules"], permissions: string[]) {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(modules, permissions));
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

describe("grupo de menú de un módulo avanzado (F9-MOD-08)", () => {
  it("con el módulo y el permiso aparece «Recepción» con sus dos entradas", async () => {
    await renderCon(["reception"], ["reception:read"]);
    const grupo = await screen.findByRole("group", { name: "Recepción" });
    expect(grupo).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registro de cliente" })).toHaveAttribute(
      "href",
      "/reception/customers",
    );
    expect(screen.getByRole("link", { name: "Generar turno" })).toHaveAttribute(
      "href",
      "/reception/turns",
    );
  });

  it("sin el módulo no hay grupo NI candado, aunque el permiso esté", async () => {
    await renderCon([], ["reception:read"]);
    await screen.findByRole("navigation");
    expect(screen.queryByRole("group", { name: "Recepción" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recepción" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Registro de cliente" })).not.toBeInTheDocument();
  });

  it("con el módulo pero sin permiso, tampoco", async () => {
    await renderCon(["reception"], []);
    await screen.findByRole("navigation");
    expect(screen.queryByRole("group", { name: "Recepción" })).not.toBeInTheDocument();
  });
});
