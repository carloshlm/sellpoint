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
  getAdminTenantDetail: vi.fn(),
  voidPayment: vi.fn(),
}));
const mockedTenants = vi.mocked(billingApi.getAdminTenants);
const mockedRecord = vi.mocked(billingApi.recordPayment);
const mockedDetail = vi.mocked(billingApi.getAdminTenantDetail);
const mockedVoid = vi.mocked(billingApi.voidPayment);

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
          timezone: "America/Mexico_City",
          charge: { monthly: "499.00", yearly: "4990.00", currency: "MXN" },
        },
      ],
      mrrByCurrency: { MXN: "499.00" },
    });
    mockedRecord.mockResolvedValue({});
    mockedVoid.mockResolvedValue({});
    mockedDetail.mockResolvedValue({
      subscription: {
        status: "active",
        billingCycle: "monthly",
        dueAt: "2026-09-28T06:00:00.000Z",
        trialEndsAt: null,
        customPrice: null,
        plan: { code: "plus", name: "Plus" },
      },
      payments: [
        {
          id: "p1",
          paidAt: "2026-08-28T18:00:00.000Z",
          amount: "499.00",
          currency: "MXN",
          method: "transfer",
          billingCycle: "monthly",
          planCode: "plus",
          status: "recorded",
          periodStart: "2026-08-28T06:00:00.000Z",
          periodEnd: "2026-09-28T06:00:00.000Z",
          grossAmount: "499.00",
          discountAmount: "0",
          notes: null,
        },
      ],
      activeDiscount: null,
      timezone: "America/Mexico_City",
    });
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

  /**
   * El seguro del cobro (Carlos, 2026-08-29): el server rechaza un monto que
   * no cubre el plan, y la casilla es la forma de decir "lo acepto igual".
   */
  /**
   * La regla del cuadre (Carlos, 2026-08-29): recibido + descuento = precio.
   * El formulario propone el cargo y deja capturar lo que perdonaste; el
   * server rechaza cualquier combinación que no dé el precio.
   */
  it("propone el cargo y manda monto y descuento", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));

    // El cargo a la vista y ya propuesto en el campo: cuadrar la cuenta no
    // puede exigir calculadora.
    expect(screen.getByTestId("expected-charge")).toHaveTextContent("499.00 MXN");
    expect(screen.getByLabelText(/Monto recibido/)).toHaveValue("499.00");

    await user.clear(screen.getByLabelText(/Monto recibido/));
    await user.type(screen.getByLabelText(/Monto recibido/), "300.00");
    await user.clear(screen.getByLabelText("Descuento"));
    await user.type(screen.getByLabelText("Descuento"), "199.00");
    await user.click(screen.getByRole("button", { name: "Registrar" }));

    await waitFor(() => {
      expect(mockedRecord).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ amountReceived: "300.00", discountAmount: "199.00" }),
      );
    });
  });

  /**
   * Carlos (2026-08-29): «tampoco se ve el historial de pagos por cada
   * cliente». Un backoffice de cobros sin historial obliga a confiar en la
   * memoria para responder "¿este ya me pagó agosto?".
   */
  it("el nombre del negocio abre su expediente con el historial de pagos", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Acme" }));

    expect(await screen.findByTestId("tenant-detail")).toBeInTheDocument();
    expect(mockedDetail).toHaveBeenCalledWith("t1");
    expect(screen.getByText("$499.00")).toBeInTheDocument();
    // El período que cubrió el pago: la respuesta a "¿hasta cuándo pagó?".
    expect(screen.getByText(/28\/8\/2026 — 27\/9\/2026/)).toBeInTheDocument();
  });

  it("desde el expediente se anula un pago, con su razón", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Acme" }));
    await screen.findByTestId("tenant-detail");

    await user.click(screen.getByRole("button", { name: "Anular" }));
    await user.type(screen.getByLabelText(/Por qué se anula/), "transferencia rebotada");
    await user.click(screen.getByRole("button", { name: "Anular el pago" }));

    await waitFor(() => {
      expect(mockedVoid).toHaveBeenCalledWith("t1", "p1", "transferencia rebotada");
    });
  });

  /** El negocio anterior a la Fase 7: sin suscripción, pero cobrable. */
  it("un negocio con status `none` se muestra como «Sin suscripción»", async () => {
    mockedTenants.mockResolvedValue({
      tenants: [
        {
          tenantId: "t2",
          tenantName: "Negocio viejo",
          country: null,
          planCode: "free",
          planName: "Free",
          status: "none",
          billingCycle: null,
          dueAt: null,
          lastPaymentAt: null,
          timezone: "America/Mexico_City",
          charge: null,
        },
      ],
      mrrByCurrency: {},
    });
    await renderAdmin(true);

    expect(await screen.findByText("Negocio viejo")).toBeInTheDocument();
    expect(screen.getByText("Sin suscripción")).toBeInTheDocument();
    // Y sigue teniendo su botón de cobro: es a quien hay que cobrarle.
    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeInTheDocument();
  });

  it("sin el flag, la ruta redirige al dashboard — la pantalla ni se pinta", async () => {
    const router = await renderAdmin(false);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/dashboard");
    });
    expect(screen.queryByTestId("admin-billing")).not.toBeInTheDocument();
  });
});
