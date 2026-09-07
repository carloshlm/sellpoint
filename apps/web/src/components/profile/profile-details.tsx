import { zodResolver } from "@hookform/resolvers/zod";
import { asksSecondSurname } from "@sellpoint/shared";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/lib/api";
import type { UpdateMyProfileInput } from "@/lib/auth/api";
import { useUpdateMyProfile } from "@/lib/auth/hooks";
import { type ProfileDetailsValues, profileDetailsSchema } from "@/lib/auth/schemas";
import { LAST_NAME_LABEL_KEY, nameFormatOf } from "@/lib/name-format";
import type { AuthUser } from "@/stores/auth.store";
import { useAuthStore } from "@/stores/auth.store";

/**
 * "Tus datos" editable (Carlos, 2026-08-26): lo que el registro capturó una
 * vez (nombre, apellido paterno y materno) se corrige aquí para siempre —
 * mismo principio que Datos del negocio con el wizard.
 *
 * El EMAIL no se edita: es la identidad de acceso (con él entras y con él se
 * verificó la cuenta). Cambiarlo exige su propio flujo con re-verificación
 * del correo nuevo — prometer la edición sin ese flujo sería regalar
 * cuentas con correos sin verificar. Se muestra con la explicación.
 *
 * PATCH parcial por dirtyFields (mismo contrato que Datos del negocio) y al
 * éxito el store se actualiza en el momento: el nombre del header no puede
 * quedarse un reload atrás.
 */
function ProfileDetails({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  // F1-NAME-08: la etiqueta del apellido la decide el país del negocio.
  const formatoDeNombre = nameFormatOf();
  // F1-NAME-09 — LA LEY: el FORMATO decide qué se PIDE, el DATO decide qué se
  // MUESTRA. Un segundo apellido ya guardado se ve y se edita aunque el país
  // sea de uno solo — y si el campo NO se dibuja, la llave no viaja en el
  // submit: esconder jamás es borrar. Se calcula con el valor PERSISTIDO y no
  // con el del input, porque si no el campo se esfumaría mientras lo vacían.
  const pideSegundoApellido =
    asksSecondSurname(formatoDeNombre) || (user.secondLastName ?? "") !== "";
  const updateProfile = useUpdateMyProfile();
  const setUser = useAuthStore((state) => state.setUser);
  const [apiError, setApiError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<ProfileDetailsValues>({
    resolver: zodResolver(profileDetailsSchema),
    defaultValues: {
      firstName: user.firstName,
      lastName: user.lastName,
      secondLastName: user.secondLastName ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setApiError(null);
    setSucceeded(false);

    const patch: UpdateMyProfileInput = {};
    if (dirtyFields.firstName) patch.firstName = values.firstName.trim();
    if (dirtyFields.lastName) patch.lastName = values.lastName.trim();
    if (pideSegundoApellido && dirtyFields.secondLastName) {
      // Vacío BORRA (null): el materno es opcional desde el registro.
      const trimmed = values.secondLastName.trim();
      patch.secondLastName = trimmed === "" ? null : trimmed;
    }

    if (Object.keys(patch).length === 0) {
      reset(values);
      return;
    }

    updateProfile.mutate(patch, {
      onSuccess: (summary) => {
        setSucceeded(true);
        setUser({
          ...user,
          firstName: summary.firstName,
          lastName: summary.lastName,
          secondLastName: summary.secondLastName,
        });
        reset({
          firstName: summary.firstName,
          lastName: summary.lastName,
          secondLastName: summary.secondLastName ?? "",
        });
      },
      onError: (error: ApiError) => {
        setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
      },
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("common.profile.details.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex max-w-md flex-col gap-4"
          data-testid="profile-details"
        >
          {apiError && (
            <p
              role="alert"
              data-testid="profile-details-error"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {apiError}
            </p>
          )}
          {succeeded && (
            <p
              role="status"
              data-testid="profile-details-success"
              className="rounded-md bg-success/10 px-3 py-2 text-sm text-success"
            >
              {t("common.profile.details.success")}
            </p>
          )}
          <TextField
            label={t("common.name.firstName")}
            autoComplete="given-name"
            error={errors.firstName?.message ? t(errors.firstName.message) : undefined}
            {...register("firstName")}
          />
          <TextField
            label={t(LAST_NAME_LABEL_KEY[formatoDeNombre])}
            autoComplete="family-name"
            error={errors.lastName?.message ? t(errors.lastName.message) : undefined}
            {...register("lastName")}
          />
          {pideSegundoApellido && (
            <TextField
              label={t("common.name.secondLastName")}
              error={errors.secondLastName?.message ? t(errors.secondLastName.message) : undefined}
              {...register("secondLastName")}
            />
          )}
          <div className="flex flex-col gap-2">
            <Label>{t("common.profile.details.email")}</Label>
            <p data-testid="profile-email" className="text-sm">
              {user.email}
            </p>
            <p className="text-xs text-muted-foreground">{t("common.profile.details.emailHint")}</p>
          </div>
          <Button type="submit" disabled={!isDirty || updateProfile.isPending}>
            {updateProfile.isPending
              ? t("common.form.submitting")
              : t("common.profile.business.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export { ProfileDetails };
