import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as billingApi from "@/lib/billing/api";
import { useAuthStore } from "@/stores/auth.store";
import { useBillingStore } from "@/stores/billing.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { PlansModal } from "./plans-modal";

let navegado: unknown = null;
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => (args: unknown) => {
    navegado = args;
  },
}));

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

function renderModal(lang: "es" | "en" = "es") {
  useBillingStore.setState({ plansModalOpen: true });
  const i18n = createI18n();
  void i18n.changeLanguage(lang);
  return render(
    <I18nextProvider i18n={i18n}>
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
    // TODO cambio de plan en cobro manual pasa por contacto, cada tarjeta que
    // no es la actual lleva su «Me interesa» (F7-CONTACT-02): un BOTÓN que
    // lleva a escribir, no un texto que informa y deja a la persona buscando
    // dónde hacerlo.
    expect(screen.getByText("A tu medida")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Me interesa" }).length).toBeGreaterThanOrEqual(1);
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

  /**
   * F9-PLANMOD-06 — los módulos de plan se derivan de `MODULE_MIN_PLAN`, no
   * de `features`: Gastos desde Basic, Compras desde Pro. Plus los trae los
   * dos; Basic solo Gastos, y Compras queda dicho como no incluido.
   */
  it("Basic incluye Gastos y NO Compras; Plus incluye los dos", async () => {
    renderModal();

    const basic = await screen.findByTestId("plan-basic");
    expect(within(basic).getByTestId("plan-basic-module-expenses")).toHaveTextContent("✓Gastos");
    expect(within(basic).getByTestId("plan-basic-module-purchases")).toHaveTextContent("—Compras");
    expect(within(basic).getByTestId("plan-basic-module-purchases")).toHaveAttribute(
      "title",
      "No incluido: Compras",
    );

    const plus = screen.getByTestId("plan-plus");
    expect(within(plus).getByTestId("plan-plus-module-purchases")).toHaveTextContent("✓Compras");
    expect(within(plus).getByTestId("plan-plus-module-expenses")).toHaveTextContent("✓Gastos");
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
    // ⚠ El texto COMPLETO, no una subcadena: la versión anterior afirmaba
    // /Sin límite/ y pasaba mientras la pantalla decía «Sin límite · 2
    // usuarios». Lo cazó una captura de Playwright, no la suite.
    const premium = screen.getByTestId("plan-premium");
    expect(premium).toHaveTextContent("Usuarios ilimitados");
    expect(premium).toHaveTextContent("Almacenes ilimitados");
    expect(premium).not.toHaveTextContent("2 usuarios");
  });

  /**
   * Carlos (2026-09-05): la descripción del plan se guarda en la base en
   * español; en pantalla manda el idioma del usuario. Lo de la base queda
   * de respaldo para un plan que el web no conozca.
   */
  it("la descripción del plan habla el idioma del usuario, no el de la base", async () => {
    renderModal("en");
    expect(await screen.findByText("Full POS without inventory control")).toBeInTheDocument();
    expect(screen.queryByText("POS sin control de inventario")).not.toBeInTheDocument();
  });

  it("en español, la descripción también sale del catálogo del web", async () => {
    renderModal("es");
    expect(await screen.findByText("POS completo sin control de inventario")).toBeInTheDocument();
  });
});

/**
 * F7-CONTACT-02 (Carlos, 2026-09-07) — el modal no cobra nada, así que su
 * única salida útil es dejar a la persona escribiendo. Cada plan manda el suyo.
 */
describe("del plan al mensaje (F7-CONTACT-02)", () => {
  it("«Me interesa» cierra el modal y lleva a Mi plan con ESE plan en la URL", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText("Premium");

    // El botón de UNA tarjeta concreta: cada plan manda el suyo, no el primero
    // que aparezca.
    const tarjetaPremium = screen.getByTestId("plan-premium");
    await user.click(within(tarjetaPremium).getByRole("button", { name: "Me interesa" }));

    expect(navegado).toEqual({ to: "/settings/billing", search: { interes: "premium" } });
    // Y el modal se cierra: quedaría tapando el formulario al que acaba de mandar.
    expect(useBillingStore.getState().plansModalOpen).toBe(false);
  });

  it("«escríbenos» del pie lleva al mismo lugar, pero sin plan: nadie eligió uno", async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByText("Premium");

    await user.click(screen.getByRole("button", { name: "escríbenos" }));

    expect(navegado).toEqual({ to: "/settings/billing", search: {} });
  });

  it("el pie ya no promete que la información nunca se borra: nadie lo había preguntado", async () => {
    renderModal();
    await screen.findByText("Premium");

    expect(screen.queryByText(/nunca se borra/)).not.toBeInTheDocument();
    expect(screen.getByText(/Para contratar o cambiar de plan,/)).toBeInTheDocument();
  });
});
