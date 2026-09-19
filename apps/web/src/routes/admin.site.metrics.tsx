import {
  SITE_EVENT_NAMES,
  SITE_MARKETS,
  type SiteEventsQuery,
  type SiteEventsSummary,
  type SiteMarket,
} from "@sellpoint/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import {
  DateRangeFilter,
  type RangoDeFechas,
  rangoUltimosDias,
} from "@/components/common/date-range-filter";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ApiError } from "@/lib/api";
import { getSiteEventsSummary } from "@/lib/site/api";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/admin/site/metrics")({
  component: SiteMetricsRoute,
});

/**
 * F11-SITE-LEAD-09 — «Números del sitio»: tráfico y conversión del sitio
 * público, en tablas — «las gráficas, cuando hagan falta» (la tarea lo pide
 * así a propósito, no es un recorte de alcance nuestro).
 */
function SiteMetricsRoute() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <SiteMetricsContent />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

/** Por omisión, los últimos 30 días: es lo que se pide en la tarea. */
const RANGO_INICIAL = rangoUltimosDias(30);

function SiteMetricsContent() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const k = (sufijo: string) => t(`common.site.metrics.${sufijo}`);

  const [rango, setRango] = useState<RangoDeFechas>(RANGO_INICIAL);
  const [mercado, setMercado] = useState<"" | SiteMarket>("");

  const filtros: SiteEventsQuery = {
    from: rango.from,
    to: rango.to,
    ...(mercado !== "" && { market: mercado }),
  };

  const { data, isPending, error } = useQuery<SiteEventsSummary, ApiError>({
    queryKey: ["admin", "site", "events-summary", filtros],
    queryFn: () => getSiteEventsSummary(filtros),
    enabled: user?.isPlatformAdmin === true,
    placeholderData: (previous) => previous,
  });

  if (user && user.isPlatformAdmin !== true) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <Card data-testid="admin-site-metrics">
      <CardHeader>
        <CardTitle>{k("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-3">
          <DateRangeFilter
            id="site-metrics"
            from={rango.from}
            to={rango.to}
            // Limpiar el rango no manda un rango vacío: `from`/`to` son
            // obligatorios para el API, así que vuelve a los últimos 30 días.
            onChange={(nuevo) =>
              setRango(nuevo.from === "" && nuevo.to === "" ? rangoUltimosDias(30) : nuevo)
            }
          />
          <div className="flex items-center gap-2">
            <Label htmlFor="site-metrics-market" className="text-sm">
              {k("market")}
            </Label>
            <select
              id="site-metrics-market"
              value={mercado}
              onChange={(event) => setMercado(event.target.value as "" | SiteMarket)}
              className="rounded-md border p-1 text-sm"
            >
              <option value="">{k("allMarkets")}</option>
              {SITE_MARKETS.map((market) => (
                <option key={market} value={market}>
                  {t(`common.site.metrics.marketNames.${market}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error !== null ? (
          <p role="alert" className="text-destructive text-sm">
            {error.message}
          </p>
        ) : isPending || data === undefined ? (
          <p role="status" className="text-muted-foreground text-sm">
            {t("common.form.loading")}
          </p>
        ) : (
          <>
            {/* Las DOS tasas que importan van destacadas, no perdidas entre
                tablas: son la razón de ser de esta pantalla. */}
            <div className="rounded-lg border bg-card p-4 text-sm" data-testid="conversion-rate">
              <p className="text-muted-foreground">{k("conversion.title")}</p>
              {data.formOpenToSubmitRate === null ? (
                <p className="text-muted-foreground">{k("conversion.empty")}</p>
              ) : (
                <p className="font-semibold text-2xl tabular-nums">
                  {t("common.site.metrics.conversion.value", {
                    rate: (data.formOpenToSubmitRate * 100).toFixed(1),
                  })}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2" data-testid="site-metrics-events">
              <h2 className="font-medium text-sm">{k("events.title")}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{k("events.columns.event")}</TableHead>
                    <TableHead className="text-right">{k("events.columns.count")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SITE_EVENT_NAMES.map((evento) => (
                    <TableRow key={evento}>
                      <TableCell>{t(`common.site.metrics.events.names.${evento}`)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {data.byEvent[evento]}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-2" data-testid="site-metrics-by-market">
              <h2 className="font-medium text-sm">{k("byMarket.title")}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{k("byMarket.columns.market")}</TableHead>
                    <TableHead className="text-right">{k("byMarket.columns.count")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SITE_MARKETS.map((market) => (
                    <TableRow key={market}>
                      <TableCell>{t(`common.site.metrics.marketNames.${market}`)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {data.byMarket[market]}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-2" data-testid="site-metrics-referrers">
              <h2 className="font-medium text-sm">{k("topReferrers.title")}</h2>
              {data.topReferrers.length === 0 ? (
                <p className="text-muted-foreground text-sm">{k("topReferrers.empty")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{k("topReferrers.columns.domain")}</TableHead>
                      <TableHead className="text-right">
                        {k("topReferrers.columns.formSubmit")}
                      </TableHead>
                      <TableHead className="text-right">
                        {k("topReferrers.columns.ctaClick")}
                      </TableHead>
                      <TableHead className="text-right">
                        {k("topReferrers.columns.total")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.topReferrers.map((referrer) => (
                      <TableRow key={referrer.domain}>
                        <TableCell>{referrer.domain}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {referrer.formSubmit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {referrer.ctaClick}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{referrer.total}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
