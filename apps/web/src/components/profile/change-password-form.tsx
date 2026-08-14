import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
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
          <TextField
            label={t("auth.changePassword.current")}
            type="password"
            autoComplete="current-password"
            error={errors.currentPassword?.message ? t(errors.currentPassword.message) : undefined}
            {...register("currentPassword")}
          />
          <TextField
            label={t("auth.changePassword.new")}
            type="password"
            autoComplete="new-password"
            hint={passwordMet ? t("auth.register.passwordOk") : t("auth.register.passwordHint")}
            hintMet={passwordMet}
            error={errors.newPassword?.message ? t(errors.newPassword.message) : undefined}
            {...register("newPassword")}
          />
          <TextField
            label={t("auth.changePassword.confirm")}
            type="password"
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
