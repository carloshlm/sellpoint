import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as billingApi from "@/lib/billing/api";
import { useAuthStore } from "@/stores/auth.store";
import { useBillingStore } from "@/stores/billing.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { PlansModal } from "./plans-modal";

vi.mock("@/lib/billing/api", async (importOriginal) => ({
  ...(await importOriginal<typeof billingApi>()),
  getPlans: vi.fn(),
}));
const mockedGetPlans = vi.mocked(billingApi.getPlans);

/**
 * F7-WEB-04 — la vitrina de planes. Los precios llegan YA resueltos por el
 * país del negocio (el server decide la moneda); el toggle anual muestra el
 * precio con 2 meses gratis; Premium no tiene precio — su CTA es contactar.
 */
const PLANES = [
  {
    code: "basic",
    name: "Basic",
    description: "POS sin control de inventario",
    maxUsers: 3,
    maxWarehouses: 1,
    features: {},
    price: { currency: "MXN", monthly: "199.00", yearly: "1990.00" },
  },
  {
    code: "plus",
    name: "Plus",
    description: "Todo",
    maxUsers: 20,
    maxWarehouses: 10,
    features: {},
    price: { currency: "MXN", monthly: "499.00", yearly: "4990.00" },
  },
  {
    code: "premium",
    name: "Premium",
    description: "A la medida",
    maxUsers: null,
    maxWarehouses: null,
    features: {},
    price: null,
  },
];

function renderModal() {
  useBillingStore.setState({ plansModalOpen: true });
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <PlansModal />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe("PlansModal (F7-WEB-04)", () => {
  beforeEach(() => {
    mockedGetPlans.mockResolvedValue(PLANES);
    useAuthStore.setState({
      accessToken: "token",
      // biome-ignore lint/suspicious/noExplicitAny: fixture parcial a propósito
      user: { subscription: { ...SUBSCRIPTION_PLUS, planCode: "basic", status: "active" } } as any,
    });
  });

  it("pinta las tarjetas con el precio mensual en la moneda resuelta y marca el plan actual", async () => {
    renderModal();

    expect(await screen.findByText("Basic")).toBeInTheDocument();
    expect(screen.getByText(/\$199\.00/)).toBeInTheDocument();
    expect(screen.getByText("Tu plan actual")).toBeInTheDocument(); // basic es el suyo
  });

  it("el toggle anual muestra el precio con 2 meses gratis", async () => {
    renderModal();
    await screen.findByText("Basic");

    await userEvent.click(screen.getByRole("button", { name: /anual/i }));

    expect(screen.getByText(/\$1,?990\.00/)).toBeInTheDocument();
  });

  it("Premium no tiene precio: su CTA es contactar", async () => {
    renderModal();

    expect(await screen.findByText("Premium")).toBeInTheDocument();
    // Sin precio publicado: la tarjeta muestra el precio a la medida, y como
    // TODO cambio de plan en cobro manual pasa por contacto, el CTA
    // Contáctanos aparece en cada tarjeta que no es la actual.
    expect(screen.getByText("A tu medida")).toBeInTheDocument();
    expect(screen.getAllByText("Contáctanos").length).toBeGreaterThanOrEqual(1);
  });

  it("cerrado vive SOLO en memoria: el estado del store no persiste nada", async () => {
    renderModal();
    await screen.findByText("Basic");

    await userEvent.keyboard("{Escape}");

    expect(useBillingStore.getState().plansModalOpen).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
