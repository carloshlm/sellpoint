import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useRegisterTenant } from "@/lib/auth/hooks";
import { type RegisterFormValues, registerSchema } from "@/lib/auth/schemas";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

/** Container: form + mutación de registro. Éxito → card "revisá tu email". */
function RegisterPage() {
  const { t, i18n } = useTranslation();
  const registerMutation = useRegisterTenant();
  const [apiError, setApiError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    mode: "onChange",
  });

  // Validación de password EN VIVO: el hint cambia a "cumple" apenas llega a 12.
  const passwordValue = watch("password") ?? "";
  const passwordMet = passwordValue.length >= 12;

  const onSubmit = handleSubmit((values) => {
    setApiError(null);
    const parsed = registerSchema.parse(values);
    registerMutation.mutate(
      {
        ...parsed,
        locale: i18n.language.startsWith("en") ? "en" : "es",
      },
      {
        onSuccess: () => setSubmittedEmail(parsed.email),
        onError: (error: ApiError) => {
          setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
        },
      },
    );
  });

  if (submittedEmail) {
    return (
      <AuthCard title={t("auth.register.successTitle")}>
        <p className="text-sm text-muted-foreground" data-testid="register-success">
          {t("auth.register.successBody", { email: submittedEmail })}
        </p>
        <Button asChild variant="outline">
          <Link to="/login">{t("auth.register.loginCta")}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("auth.register.title")}
      description={t("auth.register.subtitle")}
      footer={
        <p>
          {t("auth.register.haveAccount")}{" "}
          <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            {t("auth.register.loginCta")}
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {apiError && (
          <p
            role="alert"
            data-testid="register-api-error"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {apiError}
          </p>
        )}
        <TextField
          label={t("auth.register.tenantName")}
          autoComplete="organization"
          error={errors.tenantName?.message ? t(errors.tenantName.message) : undefined}
          {...register("tenantName")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("auth.register.firstName")}
            autoComplete="given-name"
            error={errors.firstName?.message ? t(errors.firstName.message) : undefined}
            {...register("firstName")}
          />
          <TextField
            label={t("auth.register.lastNamePaternal")}
            autoComplete="family-name"
            error={
              errors.lastNamePaternal?.message ? t(errors.lastNamePaternal.message) : undefined
            }
            {...register("lastNamePaternal")}
          />
        </div>
        <TextField
          label={t("auth.register.lastNameMaternal")}
          autoComplete="family-name"
          error={errors.lastNameMaternal?.message ? t(errors.lastNameMaternal.message) : undefined}
          {...register("lastNameMaternal")}
        />
        <TextField
          label={t("auth.register.email")}
          type="email"
          autoComplete="email"
          error={errors.email?.message ? t(errors.email.message) : undefined}
          {...register("email")}
        />
        <TextField
          label={t("auth.register.password")}
          type="password"
          autoComplete="new-password"
          hint={passwordMet ? t("auth.register.passwordOk") : t("auth.register.passwordHint")}
          hintMet={passwordMet}
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...register("password")}
        />
        <Button type="submit" size="lg" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? t("common.form.submitting") : t("auth.register.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
