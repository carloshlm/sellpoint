import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type * as billingApi from "@/lib/billing/api";
import { useAuthStore } from "@/stores/auth.store";
import { useBillingStore } from "@/stores/billing.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { PlanGate } from "./plan-gate";

vi.mock("@/lib/billing/api", async (importOriginal) => ({
  ...(await importOriginal<typeof billingApi>()),
  getPlans: vi.fn().mockResolvedValue([]),
}));

/**
 * F7-WEB-05 — el gate del free tier. SIN Navigate a propósito: el requisito
 * dice que el free tier "puede iniciar sesión y ver todo" — se le muestra la
 * app CON el modal de planes encima, cerrable. Que reaparezca en cada
 * sesión lo garantiza el store en memoria (muere con la pestaña), no un
 * condicional.
 */
function renderGate(status: string) {
  useBillingStore.setState({ plansModalOpen: false });
  useAuthStore.setState({
    accessToken: "token",
    // biome-ignore lint/suspicious/noExplicitAny: fixture parcial a propósito
    user: { subscription: { ...SUBSCRIPTION_PLUS, status } } as any,
  });
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={new QueryClient()}>
        <PlanGate />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe("PlanGate (F7-WEB-05)", () => {
  it("free tier: abre el modal de planes al montar (cada sesión, por construcción)", () => {
    renderGate("free");
    expect(useBillingStore.getState().plansModalOpen).toBe(true);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("con plan vigente no abre nada", () => {
    renderGate("active");
    expect(useBillingStore.getState().plansModalOpen).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
