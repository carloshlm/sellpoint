import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import type { UpdateTenantInput } from "@/lib/tenant/api";
import { useUpdateMyTenant } from "@/lib/tenant/hooks";
import { type BusinessDetailsValues, businessDetailsSchema } from "@/lib/tenant/schemas";
import type { AuthUser } from "@/stores/auth.store";

/**
 * "Datos del negocio" en Mi perfil (Carlos, 2026-08-25). Tarjeta APARTE de
 * "Tus datos": aquella habla de la persona (tu nombre, tu email), esta habla
 * de la empresa — mezclar ambas confunde de quién es cada dato.
 *
 * Lo que el wizard capturó una vez (nombre legal, identificación fiscal,
 * dirección) se edita aquí para siempre; el wizard no se toca. `phone` solo
 * existe en esta tarjeta y es el único campo borrable.
 *
 * Sin `tenants:manage` la tarjeta NO EXISTE — mismo criterio que el botón
 * Crear de los movimientos: deshabilitarla sugeriría que falta un clic, no
 * un permiso.
 *
 * El PATCH manda SOLO los campos modificados (dirtyFields): guardar no debe
 * ser una sobreescritura total — un admin con la pantalla abierta desde ayer
 * pisaría los cambios de otro en los campos que ni tocó. `useUpdateMyTenant`
 * re-sincroniza el store al terminar, así el resto de la app ve el tenant
 * fresco sin recargar.
 */
function BusinessDetails({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const updateTenant = useUpdateMyTenant();
  const [apiError, setApiError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<BusinessDetailsValues>({
    resolver: zodResolver(businessDetailsSchema),
    defaultValues: {
      name: user.tenant.name,
      legalName: user.tenant.legalName ?? "",
      taxId: user.tenant.taxId ?? "",
      address: user.tenant.address ?? "",
      phone: user.tenant.phone ?? "",
    },
  });

  if (!user.permissions.includes("tenants:manage")) {
    return null;
  }

  const onSubmit = handleSubmit((values) => {
    setApiError(null);
    setSucceeded(false);

    const patch: UpdateTenantInput = {};
    if (dirtyFields.name) patch.name = values.name.trim();
    if (dirtyFields.legalName) patch.legalName = values.legalName.trim();
    if (dirtyFields.taxId) patch.taxId = values.taxId.trim();
    if (dirtyFields.address) patch.address = values.address.trim();
    // Vaciar el teléfono lo BORRA (null, no ""): es el único campo que el
    // wizard nunca exigió, así que capturarlo no lo vuelve obligatorio.
    if (dirtyFields.phone) {
      const phone = values.phone.trim();
      patch.phone = phone === "" ? null : phone;
    }

    updateTenant.mutate(patch, {
      onSuccess: () => {
        setSucceeded(true);
        // `values` pasa a ser el nuevo punto de partida: isDirty vuelve a
        // false y el botón se apaga hasta el próximo cambio real.
        reset(values);
      },
      onError: (error: ApiError) => {
        setApiError(error.statusCode === 0 ? t("common.errors.network") : error.message);
      },
    });
  });

  return (
    <Card data-testid="business-details">
      <CardHeader>
        <CardTitle>{t("common.profile.business.title")}</CardTitle>
        <CardDescription>{t("common.profile.business.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex max-w-md flex-col gap-4">
          {apiError && (
            <p
              role="alert"
              data-testid="business-details-error"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {apiError}
            </p>
          )}
          {succeeded && (
            <p
              role="status"
              data-testid="business-details-success"
              className="rounded-md bg-success/10 px-3 py-2 text-sm text-success"
            >
              {t("common.profile.business.success")}
            </p>
          )}
          <TextField
            label={t("common.profile.business.name")}
            autoComplete="organization"
            error={errors.name?.message ? t(errors.name.message) : undefined}
            {...register("name")}
          />
          <TextField
            label={t("common.profile.business.legalName")}
            error={errors.legalName?.message ? t(errors.legalName.message) : undefined}
            {...register("legalName")}
          />
          <TextField
            label={t("common.profile.business.taxId")}
            error={errors.taxId?.message ? t(errors.taxId.message) : undefined}
            {...register("taxId")}
          />
          <TextField
            label={t("common.profile.business.address")}
            autoComplete="street-address"
            error={errors.address?.message ? t(errors.address.message) : undefined}
            {...register("address")}
          />
          <TextField
            label={t("common.profile.business.phone")}
            type="tel"
            autoComplete="tel"
            error={errors.phone?.message ? t(errors.phone.message) : undefined}
            {...register("phone")}
          />
          <Button type="submit" disabled={!isDirty || updateTenant.isPending}>
            {updateTenant.isPending
              ? t("common.form.submitting")
              : t("common.profile.business.submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export { BusinessDetails };
