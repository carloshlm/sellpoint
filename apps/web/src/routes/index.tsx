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
 *
 * S1 del verify de f1-web-auth: esta ruta es PÚBLICA (200 en producción) y
 * tenía el único color crudo de la paleta de Tailwind en todo `apps/web/src`,
 * más 3 strings clavados en español. El color pasa a tokens semánticos, que
 * es lo que el theming por tenant repinta; "SellPoint" se queda literal por
 * ser nombre propio. El barrido que lo impide vive en `lib/theme/brands.test.ts`.
 */
function HomePage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-3xl font-semibold">SellPoint</h1>
      <p className="text-muted-foreground" data-testid="shared-import">
        {t("common.home.demoTotal", { amount: formatMoney(1234.56, "MXN", "es") })}
      </p>
      <div
        className="rounded-lg bg-primary p-4 text-primary-foreground"
        data-testid="tailwind-check"
      >
        {t("common.home.tailwindCheck")}
      </div>
      <Button data-testid="shadcn-check">{t("common.home.demoAction")}</Button>
      <p className="text-muted-foreground" data-testid="i18n-check">
        {t("common.welcome")}
      </p>
    </main>
  );
}
