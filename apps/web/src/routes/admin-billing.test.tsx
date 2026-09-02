import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    usesLocations: false,
    monthlySalesGoal: null,
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
          currency: "MXN",
          timezone: "America/Mexico_City",
          charges: [
            { planCode: "basic", monthly: "199.00", yearly: "1990.00", currency: "MXN" },
            { planCode: "plus", monthly: "499.00", yearly: "4990.00", currency: "MXN" },
          ],
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
   * Y como uno DETERMINA al otro, teclear los dos sería pedirle al dueño que
   * haga la resta a mano: escribir uno completa el otro.
   */
  it("propone el cargo del negocio al abrir el modal", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));

    expect(screen.getByTestId("expected-charge")).toHaveTextContent("499.00 MXN");
    expect(screen.getByLabelText(/Monto recibido/)).toHaveValue("499.00");
    expect(screen.getByLabelText("Descuento")).toHaveValue("0");
  });

  it("al capturar el monto recibido, el descuento se calcula solo", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));

    await user.clear(screen.getByLabelText(/Monto recibido/));
    await user.type(screen.getByLabelText(/Monto recibido/), "300");

    expect(screen.getByLabelText("Descuento")).toHaveValue("199.00");

    await user.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => {
      expect(mockedRecord).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ amountReceived: "300", discountAmount: "199.00" }),
      );
    });
  });

  it("y al revés: capturar el descuento completa el monto recibido", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));

    await user.clear(screen.getByLabelText("Descuento"));
    await user.type(screen.getByLabelText("Descuento"), "199");

    expect(screen.getByLabelText(/Monto recibido/)).toHaveValue("300.00");
  });

  /**
   * Capturar de más no deja un descuento NEGATIVO: se queda en cero y el
   * server rechaza el desajuste, que es lo que tiene que pasar con un monto
   * que no cuadra.
   */
  it("un monto mayor que el cargo deja el descuento en cero, no en negativo", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));

    await user.clear(screen.getByLabelText(/Monto recibido/));
    await user.type(screen.getByLabelText(/Monto recibido/), "600");

    expect(screen.getByLabelText("Descuento")).toHaveValue("0.00");
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

  /**
   * Carlos (2026-08-29): «cuando un usuario no tiene un plan asignado no
   * funciona el autocompletado de Monto Recibido y Descuento».
   *
   * La causa: el precio se leía del plan VIGENTE, y estos negocios no tienen
   * ninguno. Ahora la fila trae el precio de cada plan vendible y el
   * formulario arranca proponiendo el primero — con su cuenta ya cuadrada.
   */
  it("un negocio SIN plan propone el primero vendible y autocompleta igual", async () => {
    mockedTenants.mockResolvedValue({
      tenants: [
        {
          tenantId: "t2",
          tenantName: "Negocio Cinco",
          country: "MX",
          planCode: "free",
          planName: "Free",
          status: "none",
          billingCycle: null,
          dueAt: null,
          lastPaymentAt: null,
          currency: "MXN",
          timezone: "America/Mexico_City",
          charges: [
            { planCode: "basic", monthly: "199.00", yearly: "1990.00", currency: "MXN" },
            { planCode: "plus", monthly: "499.00", yearly: "4990.00", currency: "MXN" },
          ],
        },
      ],
      mrrByCurrency: {},
    });
    await renderAdmin(true);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));

    // Arranca con el primer plan vendible y su precio, no en blanco.
    expect(screen.getByTestId("expected-charge")).toHaveTextContent("199.00 MXN");
    expect(screen.getByLabelText(/Monto recibido/)).toHaveValue("199.00");

    // Y el autocálculo funciona, que era justo lo que no pasaba.
    await user.clear(screen.getByLabelText(/Monto recibido/));
    await user.type(screen.getByLabelText(/Monto recibido/), "100");
    expect(screen.getByLabelText("Descuento")).toHaveValue("99.00");

    await user.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => {
      expect(mockedRecord).toHaveBeenCalledWith(
        "t2",
        expect.objectContaining({
          // El plan viaja SIEMPRE: sin suscripción previa el server lo exige.
          planCode: "basic",
          amountReceived: "100",
          discountAmount: "99.00",
        }),
      );
    });
  });

  it("cambiar de plan rehace la cuenta con el precio de ESE plan", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Registrar pago" }));

    // El negocio está en plus (499); al mover a basic, el cargo baja a 199.
    expect(screen.getByLabelText(/Monto recibido/)).toHaveValue("499.00");
    await user.selectOptions(screen.getByLabelText(/Plan/), "basic");

    expect(screen.getByTestId("expected-charge")).toHaveTextContent("199.00 MXN");
    expect(screen.getByLabelText(/Monto recibido/)).toHaveValue("199.00");
    expect(screen.getByLabelText("Descuento")).toHaveValue("0");
  });

  /**
   * Carlos (2026-08-29) pidió país y moneda en la tabla, y un filtro por
   * moneda: con clientes en tres mercados, una tabla que los mezcla obliga a
   * leer fila por fila para saber en qué se le cobra a cada uno.
   */
  it("la tabla muestra país y moneda, y el filtro deja solo esa moneda", async () => {
    mockedTenants.mockResolvedValue({
      tenants: [
        {
          tenantId: "t1",
          tenantName: "Acme",
          country: "MX",
          currency: "MXN",
          planCode: "plus",
          planName: "Plus",
          status: "active",
          billingCycle: "monthly",
          dueAt: null,
          lastPaymentAt: null,
          timezone: "America/Mexico_City",
          charges: [{ planCode: "plus", monthly: "499.00", yearly: "4990.00", currency: "MXN" }],
        },
        {
          tenantId: "t9",
          tenantName: "Maple Inc",
          country: "CA",
          currency: "CAD",
          planCode: "pro",
          planName: "Pro",
          status: "active",
          billingCycle: "monthly",
          dueAt: null,
          lastPaymentAt: null,
          timezone: "America/Toronto",
          charges: [{ planCode: "pro", monthly: "39.00", yearly: "390.00", currency: "CAD" }],
        },
      ],
      mrrByCurrency: { MXN: "499.00", CAD: "39.00" },
    });
    await renderAdmin(true);
    const user = userEvent.setup();

    // Dentro de la FILA: "CAD" también existe como opción del filtro, y
    // buscarlo suelto encontraría dos elementos distintos.
    const fila = (await screen.findByText("Maple Inc")).closest("tr");
    expect(fila).toHaveTextContent("CA");
    expect(fila).toHaveTextContent("CAD");

    await user.selectOptions(screen.getByLabelText("Moneda"), "CAD");

    expect(screen.getByText("Maple Inc")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    // El MRR sigue al filtro: mostrar el de una moneda que ya no se ve sería
    // un número sin tabla que lo explique.
    expect(screen.getByText(/MRR CAD/)).toBeInTheDocument();
    expect(screen.queryByText(/MRR MXN/)).not.toBeInTheDocument();
  });

  /**
   * Carlos (2026-08-29): «cuando anulas algún pago no se recarga el listado
   * de abajo». Anular corrige la historia — y el historial es justo la
   * pantalla que tiene que reflejar esa corrección al instante.
   */
  it("anular un pago recarga el historial y la tabla", async () => {
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Acme" }));
    await screen.findByTestId("tenant-detail");
    const consultasPrevias = mockedDetail.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Anular" }));
    await user.type(screen.getByLabelText(/Por qué se anula/), "transferencia rebotada");
    await user.click(screen.getByRole("button", { name: "Anular el pago" }));

    await waitFor(() => {
      expect(mockedVoid).toHaveBeenCalled();
    });
    // El expediente se vuelve a pedir: sin esto, el pago sigue viéndose vivo.
    await waitFor(() => {
      expect(mockedDetail.mock.calls.length).toBeGreaterThan(consultasPrevias);
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
          currency: "MXN",
          timezone: "America/Mexico_City",
          // Sin suscripción, pero con precios: es a quien hay que cobrarle.
          charges: [
            { planCode: "basic", monthly: "199.00", yearly: "1990.00", currency: "MXN" },
            { planCode: "plus", monthly: "499.00", yearly: "4990.00", currency: "MXN" },
          ],
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

/**
 * Carlos (2026-09-02): el historial de pagos con el estilo de las demás
 * tablas; un pago anulado se ve TENUE (no tachado), un pago real lleva fondo
 * verde de «pago exitoso» y el descuento va en una caja amarilla.
 */
describe("el historial de pagos se lee de un vistazo", () => {
  it("anulado tenue, real en verde, descuento en amarillo", async () => {
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
          amount: "399.00",
          currency: "MXN",
          method: "transfer",
          billingCycle: "monthly",
          planCode: "plus",
          status: "recorded",
          periodStart: "2026-08-28T06:00:00.000Z",
          periodEnd: "2026-09-28T06:00:00.000Z",
          grossAmount: "499.00",
          discountAmount: "100.00",
          notes: null,
        },
        {
          id: "p2",
          paidAt: "2026-08-10T18:00:00.000Z",
          amount: "499.00",
          currency: "MXN",
          method: "transfer",
          billingCycle: "monthly",
          planCode: "plus",
          status: "voided",
          periodStart: "2026-08-10T06:00:00.000Z",
          periodEnd: "2026-09-10T06:00:00.000Z",
          grossAmount: "499.00",
          discountAmount: "0",
          notes: null,
        },
      ],
      activeDiscount: null,
      timezone: "America/Mexico_City",
    });
    await renderAdmin(true);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Acme" }));
    await screen.findByTestId("tenant-detail");

    const real = screen.getByText("$399.00").closest("tr") as HTMLElement;
    const anulado = screen.getByText("Anulado").closest("tr") as HTMLElement;
    expect(real).toHaveClass("bg-success-soft");
    expect(anulado.className).toMatch(/opacity-/);
    expect(anulado.className).not.toMatch(/line-through/);
    expect(screen.getByText("$100.00")).toHaveClass("bg-warning-soft");
  });
});

/**
 * Carlos (2026-09-02): el backoffice va a crecer. En el menú es un grupo
 * propio, «Backoffice», al nivel de Catálogo, Movimientos, Punto de venta y
 * Sistema, y «Cobros» es su primer elemento — también el título de la página.
 */
describe("el menú tiene su grupo Backoffice", () => {
  it("el grupo «Backoffice» contiene «Cobros», y la página se titula así", async () => {
    await renderAdmin(true);

    const grupo = await screen.findByRole("group", { name: "Backoffice" });
    expect(within(grupo).getByRole("link", { name: "Cobros" })).toHaveAttribute(
      "href",
      "/admin/billing",
    );
    expect(
      await screen.findByText("Cobros", { selector: "[data-slot=card-title]" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Backoffice de cobros")).not.toBeInTheDocument();
  });
});
