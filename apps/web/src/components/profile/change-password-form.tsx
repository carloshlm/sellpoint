import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { PasswordField } from "@/components/form/password-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import { SESSIONS_QUERY_KEY, useChangePassword } from "@/lib/auth/hooks";
import { type ChangePasswordFormValues, changePasswordSchema } from "@/lib/auth/schemas";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-WEB-AUTH-10 (container). Lo NO obvio de este formulario:
 *
 * El backend cierra las OTRAS sesiones bumpeando `perm-epoch:{userId}`, y ese
 * bump también invalida el access token con el que se hizo esta request. Por
 * eso la respuesta trae un token NUEVO (firmado después del bump) y hay que
 * guardarlo con `setToken`: sin eso el usuario queda con un token muerto en
 * memoria. El interceptor de refresh lo rescataría en la próxima request
 * (su familia sigue viva, es la única que no se revocó), pero eso es la red
 * de seguridad, no el camino feliz.
 */
function ChangePasswordForm() {
  const { t } = useTranslation();
  const setToken = useAuthStore((state) => state.setToken);
  const email = useAuthStore((state) => state.user?.email ?? "");
  const queryClient = useQueryClient();
  const changePassword = useChangePassword();
  const [apiError, setApiError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onChange",
  });

  // Misma validación en vivo que registro y reset (política NIST compartida).
  const newPasswordValue = watch("newPassword") ?? "";
  const passwordMet = newPasswordValue.length >= 12;

  const onSubmit = handleSubmit(({ currentPassword, newPassword }) => {
    setApiError(null);
    setSucceeded(false);

    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: ({ accessToken }) => {
          setToken(accessToken);
          setSucceeded(true);
          reset();
          // La lista de sesiones activas quedó obsoleta: acabamos de matar
          // todas las demás familias.
          void queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        },
        onError: (error: ApiError) => {
          setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
        },
      },
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("auth.changePassword.title")}</CardTitle>
        <CardDescription>{t("auth.changePassword.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
          {apiError && (
            <p
              role="alert"
              data-testid="change-password-error"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {apiError}
            </p>
          )}
          {succeeded && (
            <p
              role="status"
              data-testid="change-password-success"
              className="rounded-md bg-success/10 px-3 py-2 text-sm text-success"
            >
              {t("auth.changePassword.success")}
            </p>
          )}
          {/*
            El usuario de la cuenta, OCULTO (Carlos, 2026-09-14). Chrome avisaba
            en consola «Password forms should have username fields»: sin él, el
            administrador de contraseñas no sabe a qué cuenta pertenece la
            contraseña nueva, y con varias cuentas en el sitio la guarda en la
            equivocada. Es la receta textual de Chromium para formularios de
            cambio de contraseña: el dato es obvio para la persona, no para el
            administrador. `hidden` lo saca de la vista y del lector de pantalla.
          */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            value={email}
            readOnly
            hidden
            data-testid="change-password-username"
          />
          <PasswordField
            label={t("auth.changePassword.current")}
            autoComplete="current-password"
            error={errors.currentPassword?.message ? t(errors.currentPassword.message) : undefined}
            {...register("currentPassword")}
          />
          <PasswordField
            label={t("auth.changePassword.new")}
            autoComplete="new-password"
            hint={passwordMet ? t("auth.register.passwordOk") : t("auth.register.passwordHint")}
            hintMet={passwordMet}
            error={errors.newPassword?.message ? t(errors.newPassword.message) : undefined}
            {...register("newPassword")}
          />
          <PasswordField
            label={t("auth.changePassword.confirm")}
            autoComplete="new-password"
            error={errors.confirmPassword?.message ? t(errors.confirmPassword.message) : undefined}
            {...register("confirmPassword")}
          />
          <Button type="submit" disabled={changePassword.isPending}>
            {changePassword.isPending
              ? t("common.form.submitting")
              : t("auth.changePassword.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export { ChangePasswordForm };
