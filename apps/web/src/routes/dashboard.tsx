import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

/**
 * Placeholder MÍNIMO detrás de ProtectedRoute: destino del login exitoso.
 * El layout real (sidebar + header) es F1-WEB-AUTH-09 — no vive acá.
 */
function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background p-4">
      <h1 className="text-2xl font-semibold" data-testid="dashboard-title">
        {t("common.dashboard.title")}
      </h1>
      {user && (
        <p className="text-muted-foreground">
          {t("common.dashboard.welcome", { name: user.firstName })}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("common.dashboard.placeholder")}</p>
    </main>
  );
}
