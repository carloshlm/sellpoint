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
    stockControl: false,
    dailySalesLimit: null,
    features: { pos: true, quotes: false, movements: false, lots: false },
    price: { currency: "MXN", monthly: "199.00", yearly: "1990.00" },
  },
  {
    code: "plus",
    name: "Plus",
    description: "Todo",
    maxUsers: 20,
    maxWarehouses: 10,
    stockControl: true,
    dailySalesLimit: null,
    features: {
      pos: true,
      quotes: true,
      movements: true,
      transfers: true,
      compositions: true,
      lots: true,
      custom_fields: true,
      custom_roles: true,
      reports: true,
      reports_export: true,
    },
    price: { currency: "MXN", monthly: "499.00", yearly: "4990.00" },
  },
  {
    code: "premium",
    name: "Premium",
    description: "A la medida",
    maxUsers: null,
    maxWarehouses: null,
    stockControl: true,
    dailySalesLimit: null,
    features: { pos: true, quotes: true, movements: true, lots: true },
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

/**
 * Carlos (2026-08-29): «que sea más entendible al usuario final qué incluye
 * cada plan; se ve mejor en un listado». Quien elige no lee UNA tarjeta:
 * compara tres — y para eso las capacidades tienen que estar todas, en el
 * mismo orden, en las tres.
 */
describe("el listado de lo que incluye cada plan", () => {
  it("Plus muestra sus capacidades como incluidas", async () => {
    renderModal();

    const plus = await screen.findByTestId("plan-plus");
    expect(plus).toHaveTextContent("Control de inventario");
    expect(plus).toHaveTextContent("Lotes y caducidades");
    expect(plus).toHaveTextContent("Cotizaciones");
  });

  /**
   * La clave de poder comparar: lo NO incluido no se esconde, se muestra
   * apagado. Con listas de distinto largo la vista no puede saltar de una
   * tarjeta a otra por la misma línea.
   */
  it("Basic muestra TAMBIÉN lo que no trae, para poder comparar", async () => {
    renderModal();

    const basic = await screen.findByTestId("plan-basic");
    // Están las once líneas en las dos tarjetas, incluidas o no.
    expect(basic).toHaveTextContent("Control de inventario");
    expect(basic).toHaveTextContent("Cotizaciones");
    // Y lo que no incluye queda dicho en texto, no solo por el color.
    expect(basic.querySelector('[title^="No incluido"]')).not.toBeNull();
  });

  /** Vender sin existencias es una VENTAJA del mostrador sin inventario. */
  it("Basic explica que puede vender sin existencias cargadas", async () => {
    renderModal();

    const basic = await screen.findByTestId("plan-basic");
    expect(basic).toHaveTextContent(/Vende aunque no tengas existencias/);
  });

  it("los límites de usuarios y almacenes se leen en palabras", async () => {
    renderModal();

    const basic = await screen.findByTestId("plan-basic");
    expect(basic).toHaveTextContent("3 usuarios");
    expect(basic).toHaveTextContent("1 almacén");
    const premium = screen.getByTestId("plan-premium");
    expect(premium).toHaveTextContent(/Sin límite/);
  });
});
