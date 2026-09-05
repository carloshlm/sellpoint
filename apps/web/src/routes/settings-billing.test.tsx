import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
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
    posShowsStock: true,
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
          createdAt: "2026-08-28T18:05:00.000Z",
          voidedAt: null,
          voidReason: null,
        },
      ],
      activeDiscount: null,
      timezone: "America/Mexico_City",
      modules: [],
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
          createdAt: "2026-08-28T18:05:00.000Z",
          voidedAt: null,
          voidReason: null,
        },
      ],
      activeDiscount: null,
      timezone: "America/Mexico_City",
      modules: [],
    });

    await renderBilling(["tenants:manage"]);

    // Misma tabla que el backoffice (Carlos, 2026-09-02): el pago real en
    // verde, el descuento en su caja amarilla, y el período con el fin como
    // límite ABIERTO: cubrió hasta el 5-sep.
    const fila = (await screen.findByText("$300.00")).closest("tr") as HTMLElement;
    expect(fila).toHaveClass("bg-success-soft");
    expect(within(fila).getByText(/5\/8\/2026 — 5\/9\/2026/)).toBeInTheDocument();
    expect(screen.getByText("$199.00")).toHaveClass("bg-warning-soft");
  });

  /**
   * Carlos (2026-09-02): del lado del cliente, el mismo estilo que en el
   * backoffice — anulados tenues — y un «Ver» que abre abajo el detalle del
   * pago, con el motivo de la anulación si la hubo.
   */
  it("anulado tachado, y «Ver» abre abajo el detalle de ese pago", async () => {
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
          createdAt: "2026-08-05T18:05:00.000Z",
          voidedAt: null,
          voidReason: null,
        },
        {
          id: "pay-0",
          paidAt: "2026-07-05T18:00:00.000Z",
          amount: "499.00",
          currency: "MXN",
          method: "cash",
          billingCycle: "monthly",
          planCode: "plus",
          status: "voided",
          periodStart: "2026-07-05T18:00:00.000Z",
          periodEnd: "2026-08-06T06:00:00.000Z",
          grossAmount: "499.00",
          discountAmount: "0",
          notes: null,
          createdAt: "2026-07-05T18:05:00.000Z",
          voidedAt: "2026-07-07T15:00:00.000Z",
          voidReason: "transferencia rebotada",
        },
      ],
      activeDiscount: null,
      timezone: "America/Mexico_City",
      modules: [],
    });

    await renderBilling(["tenants:manage"]);
    const user = userEvent.setup();

    const anulado = (await screen.findByText("Efectivo")).closest("tr") as HTMLElement;
    // Tachado y en gris, con el «Ver» igual de vivo que en la fila real.
    expect(anulado.className).not.toMatch(/opacity-/);
    expect(screen.getByText("Efectivo")).toHaveClass("line-through");
    const real = screen.getByText("Transferencia").closest("tr") as HTMLElement;
    expect(within(anulado).getByRole("button", { name: /^Ver pago del/ }).className).toBe(
      within(real).getByRole("button", { name: /^Ver pago del/ }).className,
    );
    expect(screen.queryByTestId("payment-detail")).not.toBeInTheDocument();

    await user.click(within(anulado).getByRole("button", { name: /^Ver pago del/ }));
    const detalle = screen.getByTestId("payment-detail");
    expect(detalle).toHaveFocus();
    expect(within(detalle).getByText("transferencia rebotada")).toBeInTheDocument();
    expect(within(detalle).getByText(/7\/7\/2026/)).toBeInTheDocument();
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
      modules: [],
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
      modules: [],
    });
    await renderBilling(["products:read"]);

    expect(screen.queryByTestId("my-plan")).not.toBeInTheDocument();
  });
});
