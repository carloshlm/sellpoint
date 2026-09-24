import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerification } from "@/components/auth/resend-verification";
import { PasswordField } from "@/components/form/password-field";
import { TextField } from "@/components/form/text-field";
import { LegalConsentFields } from "@/components/legal/legal-links";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useRegisterTenant } from "@/lib/auth/hooks";
import {
  type RegisterFormValues,
  registerSchema,
  registerWithTermsSchema,
} from "@/lib/auth/schemas";
import { termsEnabled } from "@/lib/legal/terms";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
});

/** Container: form + mutación de registro. Éxito → card "revisa tu correo". */
function RegisterPage() {
  const { t, i18n } = useTranslation();
  // F1-NAME-09: acá todavía NO existe el negocio, así que no hay país del que
  // sacar un formato: se pide Nombre + un Apellido, que es lo que no le pide
  // de más a nadie. El segundo apellido aparece después, en Mi perfil, cuando
  // el país del negocio ya se conoce.
  const registerMutation = useRegisterTenant();
  const [apiError, setApiError] = useState<string | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  // F11-SITE-LEGAL-02: con los términos dormidos, la casilla NI SE PINTA y el
  // schema es el de siempre. Se decide una vez por render y no dentro del
  // JSX para que el schema y la casilla no puedan desincronizarse.
  const pideTerminos = termsEnabled();
  const schema = pideTerminos ? registerWithTermsSchema : registerSchema;

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(schema),
    mode: "onChange",
  });

  // Validación de password EN VIVO: el hint cambia a "cumple" apenas llega a 12.
  const passwordValue = watch("password") ?? "";
  const passwordMet = passwordValue.length >= 12;
  const acceptTerms = watch("acceptTerms") === true;
  const acceptPrivacy = watch("acceptPrivacy") === true;

  const onSubmit = handleSubmit((values) => {
    setApiError(null);
    const parsed = schema.parse(values);
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
        {/* El correo que no aparece casi siempre está en spam (Carlos,
            2026-08-25): decirlo acá ahorra el soporte más repetido del mundo. */}
        <p className="text-sm text-muted-foreground">{t("auth.checkSpamHint")}</p>
        {/* F10-MANFIX-11: y si tampoco está ahí, se pide otro sin volver a
            escribir el correo — esta tarjeta ya lo conoce. */}
        <ResendVerification email={submittedEmail} />
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
        {/* Sin "Nombre del negocio" (Carlos, 2026-08-25): el negocio se
            nombra en el paso 1 del wizard (Nombre legal) — un campo menos
            entre el usuario y su cuenta. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("common.name.firstName")}
            autoComplete="given-name"
            error={errors.firstName?.message ? t(errors.firstName.message) : undefined}
            {...register("firstName")}
          />
          <TextField
            label={t("common.name.lastName.single")}
            autoComplete="family-name"
            error={errors.lastName?.message ? t(errors.lastName.message) : undefined}
            {...register("lastName")}
          />
        </div>
        <TextField
          label={t("auth.register.email")}
          type="email"
          autoComplete="email"
          error={errors.email?.message ? t(errors.email.message) : undefined}
          {...register("email")}
        />
        <PasswordField
          label={t("auth.register.password")}
          autoComplete="new-password"
          hint={passwordMet ? t("auth.register.passwordOk") : t("auth.register.passwordHint")}
          hintMet={passwordMet}
          error={errors.password?.message ? t(errors.password.message) : undefined}
          {...register("password")}
        />
        {/* F11-SITE-LEGAL-02: las dos casillas nacen SIN marcar y sin las dos
            no se envía. Dormidas no existen: ni los elementos, ni el schema
            que las exige — el registro se ve exactamente como antes. */}
        {pideTerminos && (
          <LegalConsentFields
            terms={acceptTerms}
            privacy={acceptPrivacy}
            onChange={(consent, checked) =>
              setValue(consent === "terms" ? "acceptTerms" : "acceptPrivacy", checked, {
                shouldValidate: true,
              })
            }
            errors={{
              terms: errors.acceptTerms?.message,
              privacy: errors.acceptPrivacy?.message,
            }}
          />
        )}
        <Button type="submit" size="lg" disabled={registerMutation.isPending}>
          {registerMutation.isPending ? t("common.form.submitting") : t("auth.register.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
