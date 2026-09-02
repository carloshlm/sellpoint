import { MODULE_KEYS, type ModuleKey } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TenantOverview } from "@/lib/admin/api";
import { useDisableModule, useEnableModule } from "@/lib/admin/hooks";
import { useAdminTenantScope } from "@/lib/admin/scope";
import type { ApiError } from "@/lib/api";
import { MODULE_NAV } from "@/lib/modules/nav";

/**
 * F9-ADMIN-09 — el plan y los módulos avanzados del negocio.
 *
 * Activar un módulo vuelve al negocio Premium con precio pactado (lo hace el
 * server vía `changePlan`); desactivar el último NO degrada el plan, y el
 * copy lo dice. Sin suscripción no hay nada que activar: primero un plan o
 * un pago (no se inventa la fila desde acá).
 */
export function TenantPlanTab({ overview }: { overview: TenantOverview; tenantId: string }) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`common.billing.admin.tenants.plan.${sufijo}`);
  const [customPrice, setCustomPrice] = useState(overview.subscription.customPrice ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sinSuscripcion = overview.subscription.status === "none";
  const activos = new Set<ModuleKey>(overview.modules);

  return (
    <div className="flex flex-col gap-4" data-testid="tenant-plan">
      <Card>
        <CardHeader>
          <CardTitle>{k("currentPlan")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="font-medium">
              {overview.subscription.planName ?? overview.subscription.planCode}
            </span>
            {" · "}
            {t(`common.billing.me.status.${overview.subscription.status}`)}
          </p>
          {overview.subscription.customPrice && (
            <p className="text-muted-foreground">
              {t("common.billing.admin.tenants.plan.customPriceCurrent", {
                amount: overview.subscription.customPrice,
                currency: overview.tenant.currency,
              })}
            </p>
          )}
          {sinSuscripcion && <p className="text-warning">{k("noSubscriptionHint")}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{k("modules")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">{k("enableHint")}</p>
          {error && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
            >
              {error}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="module-price">{k("customPrice")}</Label>
              <Input
                id="module-price"
                inputMode="decimal"
                value={customPrice}
                onChange={(event) => setCustomPrice(event.target.value)}
                disabled={sinSuscripcion}
              />
            </div>
            <div>
              <Label htmlFor="module-reason">{k("reason")}</Label>
              <Input
                id="module-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={sinSuscripcion}
              />
            </div>
          </div>
          <ul className="divide-y rounded-md border">
            {MODULE_KEYS.map((key) => (
              <ModuleRow
                key={key}
                moduleKey={key}
                activo={activos.has(key)}
                esElUltimo={activos.has(key) && activos.size === 1}
                deshabilitado={sinSuscripcion || reason.trim() === ""}
                customPrice={customPrice.trim()}
                reason={reason.trim()}
                onError={(apiError) => setError(apiError.message)}
                onOk={() => setError(null)}
              />
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">{k("propagationHint")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleRow({
  moduleKey,
  activo,
  esElUltimo,
  deshabilitado,
  customPrice,
  reason,
  onError,
  onOk,
}: {
  moduleKey: ModuleKey;
  activo: boolean;
  esElUltimo: boolean;
  deshabilitado: boolean;
  customPrice: string;
  reason: string;
  onError: (error: ApiError) => void;
  onOk: () => void;
}) {
  const { t } = useTranslation();
  const k = (sufijo: string) => t(`common.billing.admin.tenants.plan.${sufijo}`);
  const tenantId = useTenantIdFromContext();
  const enable = useEnableModule(tenantId);
  const disable = useDisableModule(tenantId);
  const busy = enable.isPending || disable.isPending;

  return (
    <li className="flex items-center justify-between gap-3 p-3" data-testid={`module-${moduleKey}`}>
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{t(MODULE_NAV[moduleKey].labelKey)}</span>
        <Badge variant={activo ? "success" : "default"}>
          {activo ? k("enabled") : k("disabled")}
        </Badge>
      </div>
      {activo ? (
        <div className="flex flex-col items-end gap-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={deshabilitado || busy}
            onClick={() => {
              onOk();
              disable.mutate({ moduleKey, reason }, { onError });
            }}
          >
            {k("disable")}
          </Button>
          {esElUltimo && (
            <span className="text-muted-foreground text-xs">{k("lastModuleHint")}</span>
          )}
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          disabled={deshabilitado || busy}
          onClick={() => {
            onOk();
            enable.mutate(
              { moduleKey, reason, ...(customPrice ? { customPrice } : {}) },
              { onError },
            );
          }}
        >
          {k("enable")}
        </Button>
      )}
    </li>
  );
}

/** El negocio del expediente llega por el alcance que la ruta provee. */
function useTenantIdFromContext(): string {
  return useAdminTenantScope().tenantId ?? "";
}
