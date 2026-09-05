import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TextAreaField } from "@/components/form/text-area-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TenantLifecycleView } from "@/lib/admin/api";
import { useDeleteTenant, useReactivateTenant, useSuspendTenant } from "@/lib/admin/hooks";
import type { ApiError } from "@/lib/api";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import { useAuthStore } from "@/stores/auth.store";

const MOTIVO_MIN = 5;
const MOTIVO_MAX = 300;

/**
 * F7-LIFECYCLE-08 — la «Zona de peligro» del expediente de un negocio.
 *
 * Dos acciones que no se mezclan con la suscripción: *desactivar* («ya no
 * entra», reversible, con motivo) y *eliminar* (irreversible). Eliminar solo
 * se habilita cuando el API dice `deletable` —el web NUNCA compara fechas—
 * y pide el nombre exacto y la contraseña del propio administrador. El
 * botón del diálogo no se enciende hasta que el nombre coincide: es lo que
 * evita borrar el de al lado en la lista.
 *
 * Sobre el propio negocio del administrador la tarjeta no existe: el API lo
 * rechaza con 409, pero no hay razón para ofrecerlo.
 */
export function TenantDangerZone({
  tenantId,
  tenantName,
  timezone,
  lifecycle,
  onDeleted,
}: {
  tenantId: string;
  tenantName: string;
  timezone: string;
  lifecycle: TenantLifecycleView;
  onDeleted: (name: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "en" ? "en" : "es";
  const propio = useAuthStore((state) => state.user?.tenant.id) === tenantId;
  const suspend = useSuspendTenant(tenantId);
  const reactivate = useReactivateTenant(tenantId);
  const remove = useDeleteTenant(tenantId);
  const [dialogo, setDialogo] = useState<"suspend" | "delete" | null>(null);
  const [motivo, setMotivo] = useState("");
  const [nombre, setNombre] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const k = (sufijo: string, vars?: Record<string, string | number>) =>
    t(`common.billing.admin.tenants.danger.${sufijo}`, vars);

  if (propio) {
    return null;
  }

  const cerrar = () => {
    setDialogo(null);
    setMotivo("");
    setNombre("");
    setPassword("");
    setError(null);
  };
  const onError = (apiError: ApiError) => setError(apiError.message);
  const fecha = (iso: string) => formatBusinessDate(iso, locale, timezone);
  const motivoValido = motivo.trim().length >= MOTIVO_MIN && motivo.trim().length <= MOTIVO_MAX;

  return (
    <Card className="border-destructive/40" data-testid="tenant-danger-zone">
      <CardHeader>
        <CardTitle>{k("title")}</CardTitle>
        <CardDescription>{k("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && dialogo === null && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {error}
          </p>
        )}
        {lifecycle.suspendedAt === null ? (
          <div>
            <Button
              type="button"
              variant="outline"
              disabled={suspend.isPending}
              onClick={() => {
                setError(null);
                setDialogo("suspend");
              }}
            >
              {k("suspend")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-md bg-muted px-3 py-2 text-sm">
              <p className="font-medium">
                {lifecycle.suspendedBy
                  ? k("suspendedSince", {
                      date: fecha(lifecycle.suspendedAt),
                      name: lifecycle.suspendedBy.name,
                      days: lifecycle.suspendedDays,
                    })
                  : k("suspendedSinceAnon", {
                      date: fecha(lifecycle.suspendedAt),
                      days: lifecycle.suspendedDays,
                    })}
              </p>
              {lifecycle.reason && (
                <p className="text-muted-foreground">{k("reason", { reason: lifecycle.reason })}</p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={reactivate.isPending}
                onClick={() => {
                  setError(null);
                  reactivate.mutate(undefined, { onError });
                }}
              >
                {k("reactivate")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!lifecycle.deletable || remove.isPending}
                onClick={() => {
                  setError(null);
                  setDialogo("delete");
                }}
              >
                {k("delete")}
              </Button>
              {!lifecycle.deletable && lifecycle.deletableAt && (
                <p className="text-muted-foreground text-sm">
                  {k("deleteAfter", { date: fecha(lifecycle.deletableAt) })}
                </p>
              )}
            </div>
          </div>
        )}
      </CardContent>

      {dialogo === "suspend" && (
        <ConfirmDialog
          data-testid="suspend-tenant-dialog"
          title={k("suspendTitle", { name: tenantName })}
          body={k("suspendBody")}
          confirmLabel={k("suspend")}
          cancelLabel={t("common.form.cancel")}
          busy={suspend.isPending}
          confirmDisabled={!motivoValido}
          error={error ?? undefined}
          onCancel={cerrar}
          onConfirm={() => {
            setError(null);
            suspend.mutate(motivo.trim(), { onSuccess: cerrar, onError });
          }}
        >
          <TextAreaField
            label={k("reasonLabel")}
            hint={k("reasonHint")}
            rows={3}
            maxLength={MOTIVO_MAX}
            value={motivo}
            onChange={(event) => setMotivo(event.target.value)}
          />
        </ConfirmDialog>
      )}

      {dialogo === "delete" && (
        <ConfirmDialog
          data-testid="delete-tenant-dialog"
          title={k("deleteTitle", { name: tenantName })}
          body={k("deleteBody")}
          confirmLabel={k("confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={remove.isPending}
          confirmDisabled={nombre !== tenantName || password.length === 0}
          error={error ?? undefined}
          onCancel={cerrar}
          onConfirm={() => {
            setError(null);
            remove.mutate(
              { password, confirmName: nombre },
              { onSuccess: (resultado) => onDeleted(resultado.name), onError },
            );
          }}
        >
          <TextField
            label={k("confirmNameLabel", { name: tenantName })}
            autoComplete="off"
            value={nombre}
            onChange={(event) => setNombre(event.target.value)}
          />
          <TextField
            label={k("passwordLabel")}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </ConfirmDialog>
      )}
    </Card>
  );
}
