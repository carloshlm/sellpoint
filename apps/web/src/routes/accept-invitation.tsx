import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useResetPassword } from "@/lib/auth/hooks";
import { type ResetPasswordFormValues, resetPasswordSchema } from "@/lib/auth/schemas";

interface AcceptInvitationSearch {
  token?: string;
}

export const Route = createFileRoute("/accept-invitation")({
  validateSearch: (search: Record<string, unknown>): AcceptInvitationSearch => ({
    token: typeof search.token === "string" && search.token !== "" ? search.token : undefined,
  }),
  component: AcceptInvitationPage,
});

/**
 * Gap S1 (backlog de f1-rbac): destino del mail `invite-user`. Por debajo es
 * el MISMO canje que `/reset-password` — mismo endpoint, mismo schema, misma
 * mutación — porque el backend le emite al invitado un `PasswordResetToken`
 * (con TTL de 7 días en vez de 30 min) y `POST /auth/reset-password` ya
 * promueve `invited -> active` verificando el email de paso.
 *
 * Lo único propio es el copy, y no es cosmético: quien llega acá NO pidió
 * recuperar nada. Decirle "restablecé tu contraseña" a alguien que nunca tuvo
 * una lo deja pensando que le hackearon una cuenta que no sabía que existía.
 *
 * Un token inválido/vencido NO se distingue de uno inexistente (el backend
 * devuelve siempre `auth.token_invalid`) — la salida es pedirle al admin que
 * reenvíe, no reintentar acá.
 */
function AcceptInvitationPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const acceptMutation = useResetPassword();
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(resetPasswordSchema),
    mode: "onChange",
  });

  // Misma validación en vivo que registro y reset (política NIST compartida).
  const passwordValue = watch("password") ?? "";
  const passwordMet = passwordValue.length >= 12;

  if (!token) {
    return (
      <AuthCard title={t("auth.acceptInvitation.invalidTitle")}>
        <p className="text-sm text-muted-foreground" data-testid="invitation-invalid">
          {t("auth.acceptInvitation.invalidBody")}
        </p>
        <Button asChild variant="outline">
          <Link to="/login">{t("auth.acceptInvitation.goToLogin")}</Link>
        </Button>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(({ password }) => {
    setApiError(null);
    acceptMutation.mutate(
      { token, password },
      {
        // A /login y no a /dashboard: el canje NO devuelve sesión (revoca
        // todo lo del usuario), así que el invitado tiene que loguear con la
        // password que acaba de elegir.
        onSuccess: () => navigate({ to: "/login" }),
        onError: (error: ApiError) => {
          setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
        },
      },
    );
  });

  return (
    <AuthCard
      title={t("auth.acceptInvitation.title")}
      description={t("auth.acceptInvitation.subtitle")}
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {apiError && (
          <p
            role="alert"
            data-testid="invitation-api-error"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {apiError}
          </p>
        )}
        <TextField
          label={t("auth.acceptInvitation.password")}
          type="password"
          autoComplete="new-password"
          hint={passwordMet ? t("auth.register.passwordOk") : t("auth.register.passwordHint")}
          hintMet={passwordMet}
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...register("password")}
        />
        <Button type="submit" size="lg" disabled={acceptMutation.isPending}>
          {acceptMutation.isPending
            ? t("common.form.submitting")
            : t("auth.acceptInvitation.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
