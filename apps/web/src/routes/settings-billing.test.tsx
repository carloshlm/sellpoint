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
const demoUser = (
  permissions: string[],
  subscription: Partial<AuthUser["subscription"]> = {},
): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: { ...SUBSCRIPTION_PLUS, status: "active", planName: "Plus", ...subscription },
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
    usesLocations: false,
    monthlySalesGoal: null,
  },
});

async function renderBilling(
  permissions: string[],
  subscription: Partial<AuthUser["subscription"]> = {},
) {
  useAuthStore.getState().setAuth("jwt", demoUser(permissions, subscription));
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
          grossAmount: "499.00",
          discountAmount: "0",
          notes: null,
        },
      ],
      activeDiscount: null,
      timezone: "America/Mexico_City",
    });

    await renderBilling(["tenants:manage"]);

    expect(await screen.findByTestId("my-plan")).toBeInTheDocument();
    expect(screen.getByText(/Plus/)).toBeInTheDocument();
    expect(await screen.findByText(/Transferencia/)).toBeInTheDocument();
    expect(screen.getByText(/\$499\.00/)).toBeInTheDocument();
  });

  /**
   * Carlos (2026-08-29): «cuando un cliente ve sus pagos, ¿puedes poner el
   * período que cubre cada pago? También el monto recibido y el descuento».
   *
   * Es la pregunta que trae al cliente a esta pantalla: no "cuánto pagué"
   * sino "hasta cuándo tengo pagado". Y con la regla del cuadre, el monto
   * mostrado ES el recibido — por eso no hace falta una columna aparte.
   */
  it("cada pago muestra el período que cubrió y su descuento", async () => {
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
          amount: "300.00",
          currency: "MXN",
          method: "transfer",
          billingCycle: "monthly",
          planCode: "plus",
          status: "recorded",
          periodStart: "2026-08-05T18:00:00.000Z",
          periodEnd: "2026-09-06T06:00:00.000Z",
          grossAmount: "499.00",
          discountAmount: "199.00",
          notes: null,
        },
      ],
      activeDiscount: null,
      timezone: "America/Mexico_City",
    });

    await renderBilling(["tenants:manage"]);

    // El período, con el fin como límite ABIERTO: cubrió hasta el 5-sep.
    expect(await screen.findByText(/Período: 5\/8\/2026 — 5\/9\/2026/)).toBeInTheDocument();
    // Lo que entró y lo que se le perdonó, ambos a la vista.
    expect(screen.getByText(/\$300\.00/)).toBeInTheDocument();
    expect(screen.getByText(/descuento \$199\.00/)).toBeInTheDocument();
  });

  /**
   * Carlos vio "Próximo pago: 26/8/2026" sobre una fecha que YA venció
   * (2026-08-29). Llamarle "próximo" a algo que pasó le miente al cliente
   * sobre su propia situación justo en la pantalla del cobro.
   */
  it("con el pago vencido dice que venció, no «próximo pago»", async () => {
    mockedMyBilling.mockResolvedValue({
      subscription: {
        status: "active",
        billingCycle: "monthly",
        dueAt: "2026-08-27T06:00:00.000Z",
        trialEndsAt: null,
        customPrice: null,
        plan: { code: "plus", name: "Plus" },
      },
      payments: [],
      activeDiscount: null,
      timezone: "America/Mexico_City",
    });

    await renderBilling(["tenants:manage"], { overdue: true, status: "active" });

    expect(await screen.findByText(/Venció el 26\/8\/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Próximo pago/)).not.toBeInTheDocument();
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
      timezone: "America/Mexico_City",
    });
    await renderBilling(["products:read"]);

    expect(screen.queryByTestId("my-plan")).not.toBeInTheDocument();
  });
});
