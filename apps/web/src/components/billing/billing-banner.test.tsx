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
    // biome-ignore lint/suspicious/noExplicitAny: fixture parcial a propósito
    user: { subscription: { ...SUBSCRIPTION_PLUS, ...sub } } as any,
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
