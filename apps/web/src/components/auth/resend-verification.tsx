import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useResendVerification } from "@/lib/auth/hooks";
import { type ResendVerificationFormValues, resendVerificationSchema } from "@/lib/auth/schemas";

interface ResendVerificationProps {
  /**
   * El correo, cuando la pantalla ya lo conoce (la tarjeta de «Revisa tu
   * correo» del registro). Sin él, se pide: al abrir un enlace vencido la
   * pantalla solo tiene un token que ya no sirve.
   */
  email?: string;
}

/**
 * F10-MANFIX-11 (container): pide otro correo de verificación. El enlace dura
 * 24 h y, vencido, la única salida era «¿Olvidaste tu contraseña?», porque
 * registrarse otra vez con el mismo correo responde «Ya existe una cuenta…».
 *
 * El API responde el MISMO 202 exista o no la cuenta y esté o no verificada,
 * así que el mensaje es neutral siempre. Tras enviarlo, el botón desaparece: cada
 * envío gasta el mismo presupuesto de intentos por IP que entrar y verificar, y
 * cinco clics nerviosos dejarían a la persona sin poder abrir el enlace nuevo.
 */
function ResendVerification({ email }: ResendVerificationProps) {
  const { t } = useTranslation();
  const resendMutation = useResendVerification();
  const [apiError, setApiError] = useState<string | null>(null);

  const send = (value: string) => {
    setApiError(null);
    resendMutation.mutate(value, {
      onError: (error: ApiError) => {
        setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
      },
    });
  };

  if (resendMutation.isSuccess) {
    return (
      <p
        role="status"
        data-testid="resend-verification-sent"
        className="border-t pt-4 text-sm text-muted-foreground"
      >
        {t("auth.resendVerification.sent")}
      </p>
    );
  }

  const errorMessage = apiError && (
    <p
      role="alert"
      data-testid="resend-verification-error"
      className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {apiError}
    </p>
  );

  if (email) {
    return (
      <div className="flex flex-col gap-3 border-t pt-4">
        {errorMessage}
        <p className="text-sm text-muted-foreground">
          {t("auth.resendVerification.notReceived")}{" "}
          <Button
            type="button"
            variant="link"
            className="h-auto p-0"
            disabled={resendMutation.isPending}
            onClick={() => send(email)}
          >
            {resendMutation.isPending
              ? t("common.form.submitting")
              : t("auth.resendVerification.submit")}
          </Button>
        </p>
      </div>
    );
  }

  return (
    <ResendVerificationForm onSend={send} pending={resendMutation.isPending} error={errorMessage} />
  );
}

interface ResendVerificationFormProps {
  onSend: (email: string) => void;
  pending: boolean;
  error: ReactNode;
}

/** Sin correo conocido: se pide, con la misma validación que «olvidé mi contraseña». */
function ResendVerificationForm({ onSend, pending, error }: ResendVerificationFormProps) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResendVerificationFormValues>({ resolver: zodResolver(resendVerificationSchema) });

  const onSubmit = handleSubmit(({ email }) => onSend(email));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4 border-t pt-4">
      <p className="text-sm text-muted-foreground">{t("auth.resendVerification.askEmail")}</p>
      {error}
      <TextField
        label={t("auth.resendVerification.email")}
        type="email"
        autoComplete="email"
        error={errors.email?.message ? t(errors.email.message) : undefined}
        {...register("email")}
      />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? t("common.form.submitting") : t("auth.resendVerification.submit")}
      </Button>
    </form>
  );
}

export { ResendVerification };
