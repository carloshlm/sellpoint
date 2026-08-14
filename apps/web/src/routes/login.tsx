import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@/components/auth/auth-card";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useLogin } from "@/lib/auth/hooks";
import { type LoginFormValues, loginSchema } from "@/lib/auth/schemas";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

/** Container: form + mutación + navegación. El JSX vive en LoginForm. */
function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const loginMutation = useLogin();
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit((values) => {
    setApiError(null);
    loginMutation.mutate(values, {
      onSuccess: (data) => {
        setAuth(data.accessToken, data.user);
        navigate({ to: "/dashboard" });
      },
      onError: (error: ApiError) => {
        // Cuenta sin verificar → la pantalla de verify explica qué hacer.
        if (error.code === "auth.email_not_verified") {
          // Directo a la ruta canónica (la del link del mail), sin rebotar
          // por el alias `/verify`.
          navigate({ to: "/verify-email" });
          return;
        }
        // El backend traduce `message` con el Accept-Language; error de red no tiene backend.
        setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
      },
    });
  });

  return (
    <AuthCard
      title={t("auth.login.title")}
      description={t("auth.login.subtitle")}
      footer={
        <p>
          {t("auth.login.noAccount")}{" "}
          <Link
            to="/register"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("auth.login.registerCta")}
          </Link>
        </p>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {apiError && (
          <p
            role="alert"
            data-testid="login-api-error"
            className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {apiError}
          </p>
        )}
        <TextField
          label={t("auth.login.email")}
          type="email"
          autoComplete="email"
          error={errors.email?.message ? t(errors.email.message) : undefined}
          {...register("email")}
        />
        <TextField
          label={t("auth.login.password")}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...register("password")}
        />
        <div className="text-right text-sm">
          <Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">
            {t("auth.login.forgot")}
          </Link>
        </div>
        <Button type="submit" size="lg" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? t("common.form.submitting") : t("auth.login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
