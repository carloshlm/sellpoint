import type { Currency } from "@sellpoint/shared";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { TenantDangerZone } from "@/components/admin/tenant-danger-zone";
import { TenantDashboardTab } from "@/components/admin/tenant-dashboard-tab";
import { TenantOverviewTab } from "@/components/admin/tenant-overview-tab";
import { TenantPlanTab } from "@/components/admin/tenant-plan-tab";
import { TenantReportsTab } from "@/components/admin/tenant-reports-tab";
import { TenantUsersTab } from "@/components/admin/tenant-users-tab";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { useTenantOverview } from "@/lib/admin/hooks";
import { AdminTenantScopeProvider } from "@/lib/admin/scope";
import { useAuthStore } from "@/stores/auth.store";

const TABS = ["overview", "users", "plan", "dashboard", "reports"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/admin/tenants/$tenantId")({
  component: TenantDetailPage,
  // La pestaña vive en la URL: el expediente se comparte por link.
  validateSearch: z.object({ tab: z.enum(TABS).default("overview") }),
});

/** F9-ADMIN-07 — el expediente de UN negocio, con pestañas. */
function TenantDetailPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <TenantDetailContent />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function TenantDetailContent() {
  const { t } = useTranslation();
  const { tenantId } = Route.useParams();
  const { tab } = Route.useSearch();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const { data: overview, isPending, isError } = useTenantOverview(tenantId);
  const k = (sufijo: string) => t(`common.billing.admin.tenants.${sufijo}`);

  if (user && user.isPlatformAdmin !== true) {
    return <Navigate to="/dashboard" replace />;
  }

  const irA = (nueva: Tab) =>
    navigate({ to: "/admin/tenants/$tenantId", params: { tenantId }, search: { tab: nueva } });

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-detail-page">
      <h1 className="font-semibold text-xl">{overview?.tenant.name ?? "…"}</h1>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={k("title")}>
        {TABS.map((candidata) => (
          <Button
            key={candidata}
            type="button"
            role="tab"
            aria-selected={tab === candidata}
            size="sm"
            variant={tab === candidata ? "default" : "outline"}
            onClick={() => irA(candidata)}
          >
            {k(`tabs.${candidata}`)}
          </Button>
        ))}
      </div>
      {isPending ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("common.form.loading")}
        </p>
      ) : isError || !overview ? (
        <p role="alert" className="text-destructive text-sm">
          {k("loadFailed")}
        </p>
      ) : (
        <AdminTenantScopeProvider
          tenantId={tenantId}
          currency={overview.tenant.currency as Currency}
        >
          {tab === "overview" && (
            <>
              <TenantOverviewTab overview={overview} />
              <TenantDangerZone
                tenantId={tenantId}
                tenantName={overview.tenant.name}
                timezone={overview.tenant.timezone}
                lifecycle={overview.lifecycle}
                onDeleted={() => navigate({ to: "/admin/tenants" })}
              />
            </>
          )}
          {tab === "users" && <TenantUsersTab tenantId={tenantId} />}
          {tab === "plan" && <TenantPlanTab overview={overview} tenantId={tenantId} />}
          {tab === "dashboard" && <TenantDashboardTab />}
          {tab === "reports" && <TenantReportsTab />}
        </AdminTenantScopeProvider>
      )}
    </div>
  );
}
