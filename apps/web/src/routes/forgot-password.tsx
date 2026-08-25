import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useForgotPassword } from "@/lib/auth/hooks";
import { type ForgotPasswordFormValues, forgotPasswordSchema } from "@/lib/auth/schemas";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

/**
 * Container F1-WEB-AUTH-06. El backend responde 202 SIEMPRE (anti-enumeración),
 * así que el éxito muestra el mismo "revisa tu correo" exista o no la cuenta.
 */
function ForgotPasswordPage() {
  const { t } = useTranslation();
  const forgotMutation = useForgotPassword();
  const [apiError, setApiError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormValues>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = handleSubmit(({ email }) => {
    setApiError(null);
    forgotMutation.mutate(email, {
      onSuccess: () => setSubmittedEmail(email),
      onError: (error: ApiError) => {
        setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
      },
    });
  });

  if (submittedEmail) {
    return (
      <AuthCard title={t("auth.forgot.successTitle")}>
        <p className="text-sm text-muted-foreground" data-testid="forgot-success">
          {t("auth.forgot.successBody", { email: submittedEmail })}
        </p>
        <p className="text-sm text-muted-foreground">{t("auth.checkSpamHint")}</p>
        <Button asChild variant="outline">
          <Link to="/login">{t("auth.forgot.backToLogin")}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.forgot.title")}
      description={t("auth.forgot.subtitle")}
      footer={
        <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("auth.forgot.backToLogin")}
        </Link>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {apiError && (
          <p
            role="alert"
            data-testid="forgot-api-error"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {apiError}
          </p>
        )}
        <TextField
          label={t("auth.forgot.email")}
          type="email"
          autoComplete="email"
          error={errors.email?.message ? t(errors.email.message) : undefined}
          {...register("email")}
        />
        <Button type="submit" size="lg" disabled={forgotMutation.isPending}>
          {forgotMutation.isPending ? t("common.form.submitting") : t("auth.forgot.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
