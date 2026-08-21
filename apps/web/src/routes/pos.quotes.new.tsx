import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { QuoteBuilder } from "@/components/pos/quote-builder";

/**
 * F4-QUOTE-03 — armar una cotización.
 *
 * **Sin `useSession`, a propósito.** Es la única pantalla del POS que no
 * pregunta por el turno: cotizar no exige caja. Copiar acá el guardia de
 * `/pos` sería pedir que abran una caja para contestar "¿cuánto me sale?".
 */
function NewQuoteContent() {
  const { t } = useTranslation();
  const [folio, setFolio] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-xl">{t("pos.quote.newTitle")}</h1>

      {folio !== null && (
        <p
          role="status"
          className="rounded-md bg-primary/10 px-3 py-2 font-medium text-sm"
          data-testid="quote-done"
        >
          {t("pos.quote.done", { folio })}
        </p>
      )}

      <QuoteBuilder onDone={setFolio} />
    </div>
  );
}

function NewQuoteRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="pos:quote">
            <NewQuoteContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

export const Route = createFileRoute("/pos/quotes/new")({ component: NewQuoteRoute });
