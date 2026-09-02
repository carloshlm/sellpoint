import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollableTable } from "@/components/ui/scrollable-table";
import { TABLE_HEAD_ROW, TABLE_ROW_HOVER } from "@/components/ui/table";
import { getAdminTenants } from "@/lib/billing/api";
import { formatDeadline } from "@/lib/billing/dates";
import { MODULE_NAV } from "@/lib/modules/nav";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/admin/tenants/")({
  component: TenantsPage,
});

/** F9-ADMIN-06 — «Negocios»: la lista del backoffice que abre el expediente. */
function TenantsPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <TenantsContent />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function TenantsContent() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const locale = i18n.language === "en" ? "en" : "es";
  const [busqueda, setBusqueda] = useState("");
  const { data } = useQuery({
    queryKey: ["admin", "billing", "tenants"],
    queryFn: getAdminTenants,
    enabled: user?.isPlatformAdmin === true,
  });
  const k = (sufijo: string) => t(`common.billing.admin.tenants.${sufijo}`);

  if (user && user.isPlatformAdmin !== true) {
    return <Navigate to="/dashboard" replace />;
  }

  const texto = busqueda.trim().toLowerCase();
  const filas = (data?.tenants ?? []).filter(
    (fila) => texto === "" || fila.tenantName.toLowerCase().includes(texto),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{k("title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor="tenant-search">{k("search")}</Label>
          <Input
            id="tenant-search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            className="max-w-sm"
          />
        </div>
        <ScrollableTable>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className={`border-b ${TABLE_HEAD_ROW}`}>
                <th className="px-2 py-1">{k("columns.tenant")}</th>
                <th className="px-2 py-1">{k("columns.market")}</th>
                <th className="px-2 py-1">{k("columns.plan")}</th>
                <th className="px-2 py-1">{k("columns.status")}</th>
                <th className="px-2 py-1">{k("columns.modules")}</th>
                <th className="px-2 py-1">{k("columns.dueAt")}</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr
                  key={fila.tenantId}
                  className={`border-b ${TABLE_ROW_HOVER}`}
                  data-testid={`tenant-row-${fila.tenantId}`}
                >
                  <td className="px-2 py-1">
                    <Link
                      to="/admin/tenants/$tenantId"
                      params={{ tenantId: fila.tenantId }}
                      search={{ tab: "overview" }}
                      className="font-medium text-primary hover:underline"
                    >
                      {fila.tenantName}
                    </Link>
                  </td>
                  <td className="px-2 py-1">
                    {fila.country ?? "—"} · {fila.currency}
                  </td>
                  <td className="px-2 py-1">{fila.planName}</td>
                  <td className="px-2 py-1">{t(`common.billing.me.status.${fila.status}`)}</td>
                  <td className="px-2 py-1">
                    {fila.modules.length === 0 ? (
                      "—"
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {fila.modules.map((key) => (
                          <Badge key={key} variant="success">
                            {t(MODULE_NAV[key].labelKey)}
                          </Badge>
                        ))}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    {formatDeadline(fila.dueAt, fila.timezone, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      </CardContent>
    </Card>
  );
}
