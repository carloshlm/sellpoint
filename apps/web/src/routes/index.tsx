import { formatMoney } from "@sellpoint/shared";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import "@/i18n";

export const Route = createFileRoute("/")({
  component: HomePage,
});

/**
 * Home provisional de Fase 0. Los data-testid son canarios de integración:
 * shared (formatMoney), Tailwind (clases), shadcn (Button) e i18n (react-i18next)
 * — los cubren los tests.
 */
function HomePage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-3xl font-semibold">SellPoint</h1>
      <p className="text-muted-foreground" data-testid="shared-import">
        Total demo: {formatMoney(1234.56, "MXN", "es")}
      </p>
      <div className="rounded-lg bg-blue-500 p-4 text-white" data-testid="tailwind-check">
        Tailwind activo
      </div>
      <Button data-testid="shadcn-check">Click</Button>
      <p className="text-muted-foreground" data-testid="i18n-check">
        {t("common.welcome")}
      </p>
    </main>
  );
}
