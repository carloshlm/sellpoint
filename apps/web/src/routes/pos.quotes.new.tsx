import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { PrintTicketButton } from "@/components/pos/print-ticket-button";
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
  const [generada, setGenerada] = useState<{ id: string; folio: string } | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-semibold text-xl">{t("pos.quote.newTitle")}</h1>

      {generada !== null && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-md bg-primary/10 px-3 py-2"
          data-testid="quote-done"
        >
          <p role="status" className="font-medium text-sm">
            {t("pos.quote.done", { folio: generada.folio })}
          </p>
          {/* El papel con el que el cliente vuelve. Lleva la marca COTIZACIÓN y
              la leyenda de que el precio final se calcula en caja. */}
          <PrintTicketButton kind="quote" id={generada.id} folio={generada.folio} />
        </div>
      )}

      <QuoteBuilder onDone={setGenerada} />
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
