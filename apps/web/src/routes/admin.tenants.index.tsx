import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getAdminTenants } from "@/lib/billing/api";
import { formatDeadline } from "@/lib/billing/dates";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import { MODULE_NAV } from "@/lib/modules/nav";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/admin/tenants/")({
  component: TenantsPage,
});

/**
 * F9-ADMIN-06 — «Negocios»: la lista del backoffice que abre el expediente.
 *
 * Se ve como los demás listados (Carlos, 2026-10-22, «como el catálogo de
 * productos»): título de página, el buscador y la tabla directa. Antes era una
 * tarjeta con su título chico y otra tabla adentro, con filas de 4 px.
 */
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
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{k("title")}</h1>
      </header>
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1 text-sm">
          <Label htmlFor="tenant-search">{k("search")}</Label>
          <Input
            id="tenant-search"
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
          />
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{k("columns.tenant")}</TableHead>
            <TableHead>{k("columns.market")}</TableHead>
            <TableHead>{k("columns.plan")}</TableHead>
            <TableHead>{k("columns.status")}</TableHead>
            <TableHead>{k("columns.modules")}</TableHead>
            <TableHead>{k("columns.dueAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filas.map((fila) => (
            <TableRow
              key={fila.tenantId}
              className={fila.suspendedAt === null ? undefined : "text-muted-foreground"}
              data-testid={`tenant-row-${fila.tenantId}`}
            >
              <TableCell>
                <Link
                  to="/admin/tenants/$tenantId"
                  params={{ tenantId: fila.tenantId }}
                  search={{ tab: "overview" }}
                  className="font-medium text-primary hover:underline"
                >
                  {fila.tenantName}
                </Link>
              </TableCell>
              <TableCell>
                {fila.country ?? "—"} · {fila.currency}
              </TableCell>
              <TableCell>{fila.planName}</TableCell>
              <TableCell className="whitespace-nowrap">
                {fila.suspendedAt === null
                  ? t(`common.billing.me.status.${fila.status}`)
                  : `${k("suspended")} · ${formatBusinessDate(fila.suspendedAt, locale, fila.timezone)}`}
              </TableCell>
              <TableCell>
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
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {formatDeadline(fila.dueAt, fila.timezone, locale)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
