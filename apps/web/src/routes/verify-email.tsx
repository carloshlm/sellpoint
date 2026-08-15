import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";
import { useVerifyEmail } from "@/lib/auth/hooks";
import { readTokenFromUrl } from "@/lib/auth/token-from-url";

/**
 * F1-WEB-AUTH-05. La ruta es `/verify-email` porque es EXACTAMENTE el path
 * que el backend pone en el mail (`${APP_URL}/verify-email#token=...`, ver
 * AuthService.registerTenant) y el mismo nombre del endpoint que consume.
 * `/verify` quedó como redirect por compatibilidad — ver ese archivo.
 *
 * Bug real que originó esto (2026-08-14): el mail llevaba a `/verify-email`
 * y la única ruta existente era `/verify` → NOT FOUND al hacer clic en un
 * mail de producción. Ningún test lo detectó porque todos llamaban al
 * endpoint con el token directo, sin pasar por la URL del mail.
 *
 * D3 (#347): el token ya NO se lee de `validateSearch` — viaja por
 * `location.hash` (con fallback a `?token=` para links viejos, A5 del
 * design) vía `readTokenFromUrl()`, compartido con `/reset-password` y
 * `/accept-invitation`. `validateSearch` no parsea el fragmento.
 */
export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const { t } = useTranslation();
  const [token] = useState(() => readTokenFromUrl());
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
