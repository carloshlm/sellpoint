import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { OnboardingGate } from "./onboarding-gate";

/**
 * F1-WEB-ONBOARD-01 (tarea 01.17, A2 del design). El loop es imposible por
 * CONSTRUCCIÓN: acá se prueba el componente aislado (con un árbol de rutas
 * mínimo, `/onboarding` sin el gate) — el wiring real en las rutas
 * protegidas se prueba en `routes/onboarding.test.tsx` (recarga/avance) y
 * en cada `routes/*.test.tsx` existente (que siguen viendo su contenido con
 * `onboarded: true`, ver DEMO_TENANT ahí).
 */
function tenant(overrides: Partial<AuthUser["tenant"]> = {}): AuthUser["tenant"] {
  return {
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
    onboarded: false,
    sellWithoutStock: false,
    usesLocations: false,
    ...overrides,
  };
}

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: "u1",
    email: "ana@acme.mx",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    lastNameMaternal: null,
    locale: "es",
    permissions: ["tenants:manage"],
    subscription: SUBSCRIPTION_PLUS,
    tenant: tenant(),
    ...overrides,
  };
}

async function renderAt(path: string) {
  const rootRoute = createRootRoute();
  const dashboard = createRoute({
    getParentRoute: () => rootRoute,
    path: "/dashboard",
    component: () => (
      <OnboardingGate>
        <p data-testid="dashboard-content">Dashboard</p>
      </OnboardingGate>
    ),
  });
  const onboarding = createRoute({
    getParentRoute: () => rootRoute,
    path: "/onboarding",
    // A2: SIN gate — es el destino del redirect.
    component: () => <p data-testid="onboarding-content">Onboarding</p>,
  });
  const routeTree = rootRoute.addChildren([dashboard, onboarding]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();

  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

describe("OnboardingGate", () => {
  beforeEach(() => {
    useAuthStore.getState().clearAuth();
  });

  it("tenant.onboarded=false + tenants:manage: redirige a /onboarding, NUNCA renderiza el dashboard primero", async () => {
    useAuthStore.getState().setAuth("jwt-demo", user({ tenant: tenant({ onboarded: false }) }));

    await renderAt("/dashboard");

    expect(await screen.findByTestId("onboarding-content")).toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-content")).not.toBeInTheDocument();
  });

  it("tenant.onboarded=true: renderiza los children (dashboard)", async () => {
    useAuthStore.getState().setAuth("jwt-demo", user({ tenant: tenant({ onboarded: true }) }));

    await renderAt("/dashboard");

    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-content")).not.toBeInTheDocument();
  });

  it("sin tenants:manage, tenant.onboarded=false: NO ve el wizard — pasa a los children (sin loop)", async () => {
    useAuthStore
      .getState()
      .setAuth("jwt-demo", user({ permissions: [], tenant: tenant({ onboarded: false }) }));

    await renderAt("/dashboard");

    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-content")).not.toBeInTheDocument();
  });

  // No-flash (S6/#321): la ventana entre setToken() y setAuth() del
  // bootstrap NUNCA debe renderizar un <Navigate/> — solo loading.
  it("accessToken && !user (ventana de bootstrap): muestra loading, 0 redirects", async () => {
    useAuthStore.getState().setToken("jwt-en-vuelo");

    await renderAt("/dashboard");

    expect(screen.queryByTestId("dashboard-content")).not.toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-content")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});
