import { createFileRoute } from "@tanstack/react-router";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { FeatureGate } from "@/components/billing/feature-gate";
import { AppLayout } from "@/components/layout/app-layout";
import { QuotesList } from "@/components/pos/quotes-list";

/** F4-QUOTE-03 — el listado. `pos:quote`: cotizar no es vender. */
function QuotesRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <FeatureGate feature="quotes">
            <PermissionGate need="pos:quote">
              <QuotesList />
            </PermissionGate>
          </FeatureGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/pos/quotes/")({ component: QuotesRoute });
