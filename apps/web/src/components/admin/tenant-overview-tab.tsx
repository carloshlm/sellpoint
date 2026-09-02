import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TenantOverview } from "@/lib/admin/api";
import { formatDeadline } from "@/lib/billing/dates";
import { MODULE_NAV } from "@/lib/modules/nav";

/** F9-ADMIN-07 — el resumen: conteos, plan y módulos, en tarjetas. */
export function TenantOverviewTab({ overview }: { overview: TenantOverview }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "es";
  const k = (sufijo: string) => t(`common.billing.admin.tenants.overview.${sufijo}`);
  const cifra = (etiqueta: string, valor: number | string) => (
    <div key={etiqueta} className="rounded-md border p-3">
      <dt className="text-muted-foreground text-xs">{etiqueta}</dt>
      <dd className="font-semibold text-2xl tabular-nums">{valor}</dd>
    </div>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="tenant-overview">
      <Card>
        <CardHeader>
          <CardTitle>{k("users")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-3">
            {cifra(k("active"), overview.users.active)}
            {cifra(k("invited"), overview.users.invited)}
            {cifra(k("suspended"), overview.users.suspended)}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{k("catalog")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {cifra(k("products"), overview.counts.products)}
            {cifra(k("services"), overview.counts.services)}
            {cifra(k("subcatalogs"), overview.counts.subcatalogs)}
            {cifra(k("warehouses"), overview.counts.warehouses)}
          </dl>
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{k("plan")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-xs">{k("plan")}</dt>
              <dd className="text-sm">
                {overview.subscription.status === "none"
                  ? k("noSubscription")
                  : `${overview.subscription.planName ?? overview.subscription.planCode} · ${t(
                      `common.billing.me.status.${overview.subscription.status}`,
                    )}`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{k("dueAt")}</dt>
              <dd className="text-sm">
                {formatDeadline(overview.subscription.dueAt, overview.tenant.timezone, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{k("customPrice")}</dt>
              <dd className="text-sm tabular-nums">
                {overview.subscription.customPrice
                  ? `${overview.subscription.customPrice} ${overview.tenant.currency}`
                  : "—"}
              </dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="text-muted-foreground text-xs">{k("modules")}</dt>
              <dd className="flex flex-wrap gap-1 text-sm">
                {overview.modules.length === 0
                  ? "—"
                  : overview.modules.map((key) => (
                      <Badge key={key} variant="success">
                        {t(MODULE_NAV[key].labelKey)}
                      </Badge>
                    ))}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
