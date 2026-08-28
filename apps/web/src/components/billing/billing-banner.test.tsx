import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { BillingBanner } from "./billing-banner";

/**
 * F7-WEB-06 — el estado del plan, siempre a la vista: cuenta regresiva en
 * trial, rojo en gracia, y el free tier sabe exactamente qué puede hacer.
 * `active` no pinta NADA: un plan al corriente no necesita recordatorios.
 */
function renderBanner(sub: Record<string, unknown>) {
  useAuthStore.setState({
    accessToken: "token",
    user: {
      subscription: { ...SUBSCRIPTION_PLUS, ...sub },
      // La zona del negocio: la fecha del vencimiento se lee en SU calendario.
      tenant: { timezone: "America/Mexico_City" },
      // biome-ignore lint/suspicious/noExplicitAny: fixture parcial a propósito
    } as any,
  });
  return render(
    <I18nextProvider i18n={createI18n()}>
      <BillingBanner />
    </I18nextProvider>,
  );
}

describe("BillingBanner (F7-WEB-06)", () => {
  it("en trial muestra los días restantes", () => {
    renderBanner({ status: "trialing", daysLeft: 9 });
    expect(screen.getByText(/9 días de prueba/)).toBeInTheDocument();
  });

  it("en gracia es ROJO y dice cuántos días quedan", () => {
    renderBanner({ status: "past_due", daysLeft: 5 });
    const banner = screen.getByTestId("billing-banner");
    expect(banner.textContent).toMatch(/5 días/);
  });

  it("en free explica el modo gratuito con su límite", () => {
    renderBanner({ status: "free", dailySalesLimit: 10 });
    expect(screen.getByText(/10 ventas al día/)).toBeInTheDocument();
  });

  it("active no pinta nada", () => {
    renderBanner({ status: "active" });
    expect(screen.queryByTestId("billing-banner")).not.toBeInTheDocument();
  });
});

/**
 * El limbo entre el vencimiento y el barrido de las 3 AM (Carlos,
 * 2026-08-29): movió un `due_at` al pasado en producción y la app no le
 * decía nada. El estado sigue siendo `active` hasta que el cron lo mueva
 * —eso es correcto: nadie pierde acceso por un reloj— pero avisar no puede
 * esperar a las 3 de la mañana.
 */
describe("aviso de vencimiento sin esperar al barrido", () => {
  it("un `active` marcado overdue anuncia la fecha en que venció", () => {
    renderBanner({
      status: "active",
      overdue: true,
      dueAt: "2026-08-27T06:00:00.000Z",
      daysLeft: 0,
    });

    expect(screen.getByTestId("billing-banner")).toHaveTextContent("venció el 26/8/2026");
  });

  it("un `active` al corriente sigue sin pintar nada", () => {
    renderBanner({ status: "active", overdue: false });

    expect(screen.queryByTestId("billing-banner")).not.toBeInTheDocument();
  });

  /** El aviso gana al resto: es la noticia más urgente de la pantalla. */
  it("el aviso de vencido tiene prioridad sobre el del trial", () => {
    renderBanner({
      status: "trialing",
      overdue: true,
      dueAt: "2026-08-27T06:00:00.000Z",
      daysLeft: 3,
    });

    expect(screen.getByTestId("billing-banner")).toHaveTextContent(/venció el/i);
  });
});
