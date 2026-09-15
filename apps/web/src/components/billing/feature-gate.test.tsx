import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { useAuthStore } from "@/stores/auth.store";
import { useBillingStore } from "@/stores/billing.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { FeatureGate } from "./feature-gate";

/**
 * F9-PLANLIST-05 — la puerta de una pantalla que el plan no incluye. El menú
 * ya la escondía con candado; la URL seguía abriéndola.
 */
function renderCon(quotes: boolean) {
  useAuthStore.getState().setAuth(
    "jwt",
    buildAuthUser({
      subscription: { ...SUBSCRIPTION_PLUS, features: { ...SUBSCRIPTION_PLUS.features, quotes } },
    }),
  );
  return render(
    <I18nextProvider i18n={createI18n()}>
      <FeatureGate feature="quotes">
        <p>la pantalla de cotizaciones</p>
      </FeatureGate>
    </I18nextProvider>,
  );
}

afterEach(() => {
  useAuthStore.getState().clearAuth();
  useBillingStore.setState({ plansModalOpen: false });
});

describe("FeatureGate (F9-PLANLIST-05)", () => {
  it("con el flag, pinta la pantalla", () => {
    renderCon(true);
    expect(screen.getByText("la pantalla de cotizaciones")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-lock-quotes")).not.toBeInTheDocument();
  });

  it("sin el flag, la pantalla no existe: dice qué falta con el nombre de la vitrina y abre los planes", async () => {
    renderCon(false);
    expect(screen.queryByText("la pantalla de cotizaciones")).not.toBeInTheDocument();
    expect(screen.getByText("Cotizaciones no está en tu plan")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Ver planes" }));
    expect(useBillingStore.getState().plansModalOpen).toBe(true);
  });

  it("sin sesión responde cerrado: nada de features", () => {
    useAuthStore.getState().clearAuth();
    render(
      <I18nextProvider i18n={createI18n()}>
        <FeatureGate feature="quotes">
          <p>la pantalla de cotizaciones</p>
        </FeatureGate>
      </I18nextProvider>,
    );
    expect(screen.queryByText("la pantalla de cotizaciones")).not.toBeInTheDocument();
  });
});
