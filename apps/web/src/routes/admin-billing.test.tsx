import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as billingApi from "@/lib/billing/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";

vi.mock("@/lib/billing/api", async (importOriginal) => ({
  ...(await importOriginal<typeof billingApi>()),
  getAdminTenants: vi.fn(),
  recordPayment: vi.fn(),
  getPlans: vi.fn().mockResolvedValue([]),
}));
const mockedTenants = vi.mocked(billingApi.getAdminTenants);
const mockedRecord = vi.mocked(billingApi.recordPayment);

/**
 * F7-WEB-10 — el backoffice: la tabla cross-tenant y LA operación semanal
 * (registrar un pago). El flag del front solo pinta la pantalla; la verdad
 * vive en el guard del server.
 */
const demoUser = (isPlatformAdmin: boolean): AuthUser => ({
  id: "u1",
  email: "carls.hlm@gmail.com",
  firstName: "Carlos",
  lastNamePaternal: "H",
  lastNameMaternal: null,
  locale: "es",
  permissions: ["tenants:manage"],
  isPlatformAdmin,
  subscription: SUBSCRIPTION_PLUS,
  tenant: {
    id: "tenant-1",
    name: "SellPointy HQ",
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

async function renderAdmin(isPlatformAdmin: boolean) {
  useAuthStore.getState().setAuth("jwt", demoUser(isPlatformAdmin));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/admin/billing"] }),
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

afterEach(() => {
  useAuthStore.getState().clearAuth();
});

describe("Backoffice /admin/billing (F7-WEB-10)", () => {
  beforeEach(() => {
    mockedTenants.mockResolvedValue({
      tenants: [
        {
          tenantId: "t1",
          tenantName: "Acme",
          country: "MX",
          planCode: "plus",
          planName: "Plus",
          status: "trialing",
          billingCycle: null,
          dueAt: null,
          lastPaymentAt: null,
        },
      ],
      mrrByCurrency: { MXN: "499.00" },
    });
    mockedRecord.mockResolvedValue({});
  });

  it("el admin de plataforma ve la tabla con el MRR y registra un pago", async () => {
    await renderAdmin(true);

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText(/MRR MXN: \$499\.00/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    await waitFor(() => {
      expect(mockedRecord).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ billingCycle: "monthly", method: "transfer" }),
      );
    });
  });

  it("sin el flag, la ruta redirige al dashboard — la pantalla ni se pinta", async () => {
    const router = await renderAdmin(false);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard");
    });
    expect(screen.queryByTestId("admin-billing")).not.toBeInTheDocument();
  });
});
