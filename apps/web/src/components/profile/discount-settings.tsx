import { isDiscountCode } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { NumberField } from "@/components/form/number-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SuccessNotice } from "@/components/ui/success-notice";
import type { ApiError } from "@/lib/api";
import { formatBusinessDate } from "@/lib/inventory/format-date";
import { numberFieldError, numberFieldMessage } from "@/lib/measure";
import type { UpdateTenantInput } from "@/lib/tenant/api";
import { useUpdateMyTenant } from "@/lib/tenant/hooks";
import type { AuthUser } from "@/stores/auth.store";

const TOPE = { decimals: 2, min: 0.01, max: 100 };

/**
 * F4-DISC — «Descuentos en caja» (Carlos, 2026-09-09).
 *
 * El Admin define el PIN que autoriza un descuento al cobrar y, si quiere, el
 * tope por ticket. El PIN es una credencial: viaja una vez, se guarda hasheado
 * y nunca se vuelve a mostrar — la tarjeta solo dice desde cuándo existe.
 * Sin PIN, el botón de descuento no aparece en la caja. Sin `tenants:manage`
 * la tarjeta no existe (mismo criterio que Datos del negocio).
 */
export function DiscountSettings({ user }: { user: AuthUser }) {
  const { t, i18n } = useTranslation();
  const k = (sufijo: string, args?: Record<string, string>) =>
    t(`common.profile.discounts.${sufijo}`, args);
  const update = useUpdateMyTenant();
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState("");
  const [percent, setPercent] = useState(user.tenant.discountMaxPercent ?? "");
  const [saved, setSaved] = useState<"saved" | "removed" | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  if (!user.permissions.includes("tenants:manage")) {
    return null;
  }

  const setAt = user.tenant.discountCodeSetAt;
  const errorCode = code !== "" && !isDiscountCode(code) ? k("codeInvalid") : undefined;
  const errorConfirm = code !== "" && confirm !== code ? k("codeMismatch") : undefined;
  const errorTope = numberFieldError(percent, TOPE);
  const errorPercent = errorTope ? numberFieldMessage(errorTope, t) : undefined;
  const topeActual =
    user.tenant.discountMaxPercent === null ? null : Number(user.tenant.discountMaxPercent);
  const topeNuevo = percent.trim() === "" ? null : Number(percent);
  const cambiaTope = topeNuevo !== topeActual;
  const puedeGuardar =
    (code !== "" || cambiaTope) &&
    !errorCode &&
    !errorConfirm &&
    !errorPercent &&
    !update.isPending;

  // Mismo criterio que Datos del negocio: sin red se explica; lo demás lo
  // dice el API ya traducido.
  const falla = (error: ApiError) =>
    setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);

  const enviar = (event: React.FormEvent) => {
    event.preventDefault();
    if (!puedeGuardar) return;
    setApiError(null);
    setSaved(null);
    const patch: UpdateTenantInput = {};
    if (code !== "") patch.discountCode = code;
    if (cambiaTope) patch.discountMaxPercent = topeNuevo;
    update.mutate(patch, {
      onSuccess: () => {
        setSaved("saved");
        setCode("");
        setConfirm("");
      },
      onError: falla,
    });
  };

  const quitar = () => {
    setApiError(null);
    setSaved(null);
    update.mutate(
      { discountCode: null },
      {
        onSuccess: () => setSaved("removed"),
        onError: falla,
      },
    );
  };

  return (
    <Card data-testid="discount-settings">
      <CardHeader>
        <CardTitle>{k("title")}</CardTitle>
        <CardDescription>{k("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p data-testid="discount-code-status" className="text-sm">
          {setAt
            ? k("statusSet", {
                date: formatBusinessDate(setAt, i18n.language, user.tenant.timezone),
              })
            : k("statusNone")}
        </p>
        {apiError && (
          <p
            role="alert"
            className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
          >
            {apiError}
          </p>
        )}
        {saved === "saved" && (
          <SuccessNotice testId="discount-settings-success">{k("saved")}</SuccessNotice>
        )}
        {saved === "removed" && (
          <SuccessNotice testId="discount-settings-success">{k("removedNotice")}</SuccessNotice>
        )}
        <form onSubmit={enviar} className="flex flex-col gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={k(setAt ? "codeReplace" : "code")}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              error={errorCode}
              hint={k("codeHint")}
            />
            <TextField
              label={k("confirm")}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
              error={errorConfirm}
            />
            <NumberField
              label={k("maxPercent")}
              unit="%"
              decimals={2}
              value={percent}
              onChange={setPercent}
              error={errorPercent}
              hint={k("maxPercentHint")}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!puedeGuardar}>
              {t("common.form.save")}
            </Button>
            {setAt && (
              <Button type="button" variant="outline" disabled={update.isPending} onClick={quitar}>
                {k("remove")}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
