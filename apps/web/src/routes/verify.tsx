import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { useVerifyEmail } from "@/lib/auth/hooks";

interface VerifySearch {
  token?: string;
}

export const Route = createFileRoute("/verify")({
  validateSearch: (search: Record<string, unknown>): VerifySearch => ({
    token: typeof search.token === "string" && search.token !== "" ? search.token : undefined,
  }),
  component: VerifyPage,
});

/**
 * Container F1-WEB-AUTH-05: lee el token de la URL y verifica al montar.
 * Sin token (ej. login redirige por auth.email_not_verified) → "revisá tu email".
 */
function VerifyPage() {
  const { t } = useTranslation();
  const { token } = Route.useSearch();
  const verifyMutation = useVerifyEmail();
  // El token es de UN solo uso: el guard evita el doble disparo de StrictMode.
  const firedRef = useRef(false);

  useEffect(() => {
    if (token && !firedRef.current) {
      firedRef.current = true;
      verifyMutation.mutate(token);
    }
  }, [token, verifyMutation]);

  const goToLogin = (
    <Button asChild size="lg">
      <Link to="/login">{t("auth.verify.goToLogin")}</Link>
    </Button>
  );

  if (!token) {
    return (
      <AuthCard title={t("auth.verify.checkEmailTitle")}>
        <p className="text-sm text-muted-foreground" data-testid="verify-check-email">
          {t("auth.verify.checkEmailBody")}
        </p>
        {goToLogin}
      </AuthCard>
    );
  }

  if (verifyMutation.isSuccess) {
    return (
      <AuthCard title={t("auth.verify.successTitle")}>
        <p className="text-sm text-muted-foreground" data-testid="verify-success">
          {t("auth.verify.successBody")}
        </p>
        {goToLogin}
      </AuthCard>
    );
  }

  if (verifyMutation.isError) {
    return (
      <AuthCard title={t("auth.verify.errorTitle")}>
        <p role="alert" data-testid="verify-error" className="text-sm text-destructive">
          {verifyMutation.error.statusCode === 0
            ? t("common.errors.network")
            : verifyMutation.error.message}
        </p>
        <Button asChild variant="outline" size="lg">
          <Link to="/register">{t("auth.verify.goToRegister")}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("auth.verify.title")}>
      <p aria-live="polite" className="text-sm text-muted-foreground" data-testid="verify-loading">
        {t("auth.verify.verifying")}
      </p>
    </AuthCard>
  );
}
