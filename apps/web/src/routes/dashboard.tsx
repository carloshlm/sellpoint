import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/dashboard")({
  component: DashboardPage,
});

/** Ruta protegida + shell autenticado (F1-WEB-AUTH-09). */
function DashboardPage() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <DashboardContent />
      </AppLayout>
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold" data-testid="dashboard-title">
        {t("common.dashboard.title")}
      </h1>
      {user && (
        <p className="text-muted-foreground">
          {t("common.dashboard.welcome", { name: user.firstName })}
        </p>
      )}
      <p className="text-sm text-muted-foreground">{t("common.dashboard.placeholder")}</p>
    </div>
  );
}
