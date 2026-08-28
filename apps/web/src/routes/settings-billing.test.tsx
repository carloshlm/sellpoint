import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as billingApi from "@/lib/billing/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

vi.mock("@/lib/billing/api", async (importOriginal) => ({
  ...(await importOriginal<typeof billingApi>()),
  getMyBilling: vi.fn(),
  getPlans: vi.fn().mockResolvedValue([]),
}));
const mockedMyBilling = vi.mocked(billingApi.getMyBilling);

/** F7-WEB-09 — "Mi plan": estado del ciclo + historial, solo tenants:manage. */
const demoUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: { ...SUBSCRIPTION_PLUS, status: "active", planName: "Plus" },
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    address: null,
    phone: null,
    theme: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
  },
});

async function renderBilling(permissions: string[]) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings/billing"] }),
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

describe("Mi plan /settings/billing (F7-WEB-09)", () => {
  it("muestra el plan, el vencimiento y el historial de pagos propio", async () => {
    mockedMyBilling.mockResolvedValue({
      subscription: {
        status: "active",
        billingCycle: "monthly",
        dueAt: "2026-09-06T06:00:00.000Z",
        trialEndsAt: null,
        customPrice: null,
        plan: { code: "plus", name: "Plus" },
      },
      payments: [
        {
          id: "pay-1",
          paidAt: "2026-08-05T18:00:00.000Z",
          amount: "499.00",
          currency: "MXN",
          method: "transfer",
          billingCycle: "monthly",
          planCode: "plus",
          status: "recorded",
          periodStart: "2026-08-05T18:00:00.000Z",
          periodEnd: "2026-09-06T06:00:00.000Z",
          notes: null,
        },
      ],
      activeDiscount: null,
    });

    await renderBilling(["tenants:manage"]);

    expect(await screen.findByTestId("my-plan")).toBeInTheDocument();
    expect(screen.getByText(/Plus/)).toBeInTheDocument();
    expect(await screen.findByText(/Transferencia/)).toBeInTheDocument();
    expect(screen.getByText(/\$499\.00/)).toBeInTheDocument();
  });

  it("sin tenants:manage la pantalla NO existe", async () => {
    mockedMyBilling.mockResolvedValue({
      subscription: {
        status: "active",
        billingCycle: null,
        dueAt: null,
        trialEndsAt: null,
        customPrice: null,
        plan: { code: "plus", name: "Plus" },
      },
      payments: [],
      activeDiscount: null,
    });
    await renderBilling(["products:read"]);

    expect(screen.queryByTestId("my-plan")).not.toBeInTheDocument();
  });
});
