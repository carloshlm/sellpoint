import type { SiteLeadsPage, SiteLeadsQuery } from "@sellpoint/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { DateRangeFilter, type RangoDeFechas } from "@/components/common/date-range-filter";
import { AppLayout } from "@/components/layout/app-layout";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paginator } from "@/components/ui/paginator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import { getSiteLeads } from "@/lib/site/api";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/admin/site/leads")({
  component: SiteLeadsRoute,
});

/**
 * F11-SITE-LEAD-08 — «Prospectos del sitio»: la lista de solo lectura de
 * quien llenó el formulario de `sellpointy.com`. Es la red para el día que
 * un correo de aviso no llegue, así que «Sin avisar» tiene que saltar a la
 * vista y no perderse entre las demás columnas.
 */
function SiteLeadsRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <SiteLeadsContent />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

const PAGE_SIZE = 20;

function SiteLeadsContent() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const locale = i18n.language === "en" ? "en" : "es";
  const k = (sufijo: string) => t(`common.site.leads.${sufijo}`);

  const [rango, setRango] = useState<RangoDeFechas>({ from: "", to: "" });
  const [page, setPage] = useState(1);

  const filtros: SiteLeadsQuery = {
    ...(rango.from !== "" && { from: rango.from }),
    ...(rango.to !== "" && { to: rango.to }),
    page,
    pageSize: PAGE_SIZE,
  };

  const { data, isPending, error } = useQuery<SiteLeadsPage, ApiError>({
    queryKey: ["admin", "site", "leads", filtros],
    queryFn: () => getSiteLeads(filtros),
    enabled: user?.isPlatformAdmin === true,
    placeholderData: (previous) => previous,
  });

  if (user && user.isPlatformAdmin !== true) {
    return <Navigate to="/dashboard" replace />;
  }

  const rows = data?.items ?? [];

  return (
    <Card data-testid="admin-site-leads">
      <CardHeader>
        <CardTitle>{k("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DateRangeFilter
          id="site-leads"
          from={rango.from}
          to={rango.to}
          onChange={(nuevo) => {
            setRango(nuevo);
            setPage(1);
          }}
        />

        {error !== null ? (
          <p role="alert" className="text-destructive text-sm">
            {error.message}
          </p>
        ) : isPending ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("common.form.loading")}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{k("empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{k("columns.date")}</TableHead>
                <TableHead>{k("columns.name")}</TableHead>
                <TableHead>{k("columns.email")}</TableHead>
                <TableHead>{k("columns.country")}</TableHead>
                <TableHead>{k("columns.plan")}</TableHead>
                <TableHead>{k("columns.businessType")}</TableHead>
                <TableHead>{k("columns.notified")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((lead) => (
                <TableRow key={lead.id} data-testid={`site-lead-${lead.id}`}>
                  <TableCell className="whitespace-nowrap">
                    {formatBusinessDate(lead.createdAt, locale, undefined, true)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium">{lead.name}</span>
                      {/* El mensaje completo, debajo del nombre y atenuado: más
                          simple que una fila expandible y se lee igual de bien. */}
                      {lead.message !== null && (
                        <span className="text-muted-foreground text-xs">{lead.message}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <a href={`mailto:${lead.email}`} className="text-primary hover:underline">
                      {lead.email}
                    </a>
                  </TableCell>
                  <TableCell>{lead.country}</TableCell>
                  <TableCell>{t(`common.site.leads.planInterest.${lead.planInterest}`)}</TableCell>
                  <TableCell>{lead.businessType ?? "—"}</TableCell>
                  <TableCell>
                    {/* El «Sin avisar» es la red del día que un correo no
                        llegue: tiene que saltar a la vista (warning), nunca
                        pasar como un dato más. */}
                    <Badge variant={lead.notified ? "success" : "warning"}>
                      {lead.notified ? k("notified") : k("notNotified")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <Paginator
          page={page}
          pageSize={data?.pageSize ?? PAGE_SIZE}
          total={data?.total ?? 0}
          onPageChange={setPage}
        />
      </CardContent>
    </Card>
  );
}
