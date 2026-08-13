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

interface ResetSearch {
  token?: string;
}

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search: Record<string, unknown>): ResetSearch => ({
    token: typeof search.token === "string" && search.token !== "" ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

/** Container F1-WEB-AUTH-07: token de la URL + password nueva → login. */
function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token } = Route.useSearch();
  const resetMutation = useResetPassword();
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

  // Misma validación en vivo que el registro (política NIST compartida).
  const passwordValue = watch("password") ?? "";
  const passwordMet = passwordValue.length >= 12;

  if (!token) {
    return (
      <AuthCard title={t("auth.reset.invalidTitle")}>
        <p className="text-sm text-muted-foreground" data-testid="reset-invalid">
          {t("auth.reset.invalidBody")}
        </p>
        <Button asChild variant="outline">
          <Link to="/forgot-password">{t("auth.reset.requestNew")}</Link>
        </Button>
      </AuthCard>
    );
  }

  const onSubmit = handleSubmit(({ password }) => {
    setApiError(null);
    resetMutation.mutate(
      { token, password },
      {
        onSuccess: () => navigate({ to: "/login" }),
        onError: (error: ApiError) => {
          setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
        },
      },
    );
  });

  return (
    <AuthCard title={t("auth.reset.title")} description={t("auth.reset.subtitle")}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {apiError && (
          <p
            role="alert"
            data-testid="reset-api-error"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {apiError}
          </p>
        )}
        <TextField
          label={t("auth.reset.password")}
          type="password"
          autoComplete="new-password"
          hint={passwordMet ? t("auth.register.passwordOk") : t("auth.register.passwordHint")}
          hintMet={passwordMet}
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...register("password")}
        />
        <Button type="submit" size="lg" disabled={resetMutation.isPending}>
          {resetMutation.isPending ? t("common.form.submitting") : t("auth.reset.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
