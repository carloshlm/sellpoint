import { zodResolver } from "@hookform/resolvers/zod";
import * as React from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { RoleSummary, UserDetail } from "@/lib/rbac/api";
import { type UserFormValues, userFormSchema } from "@/lib/rbac/schemas";

interface UserFormProps {
  mode: "create" | "edit";
  /** Requerido en `mode: "edit"` — precarga el form (F1-WEB-USERS-03). */
  user?: UserDetail;
  roles: RoleSummary[];
  /** W1: true si el catálogo de roles no se pudo cargar (sin `roles:read` o error de red) — reemplaza el checklist por un mensaje explicando por qué. */
  rolesUnavailable?: boolean;
  /** Permisos del ACTOR (no del usuario editado) — alimenta D8. */
  actorPermissionCodes: string[];
  isSubmitting: boolean;
  /** 409 `users.email_taken`, ya traducido por el backend (D10). */
  emailError?: string | null;
  /** Cualquier otro error de la mutación — banner, no rompe el form. */
  formError?: string | null;
  onSubmit: (values: UserFormValues) => void;
  onCancel: () => void;
}

/**
 * F1-WEB-USERS-02/03 (WU4). Un solo form para alta y edición (D7): en
 * `mode: "edit"` el email queda DESHABILITADO — `updateUserSchema` del API
 * no lo acepta, un input editable ahí sería mentirle a quien lo llena.
 *
 * Multi-select de roles como checklist de checkboxes (D8), no
 * `<select multiple>`: deshabilita los roles cuyo `permissionCodes` no es
 * subconjunto de `actorPermissionCodes` — evita que el 403 de
 * `assertNoRoleAssignmentEscalation` rompa el submit en vez de prevenirlo.
 */
function UserForm({
  mode,
  user,
  roles,
  rolesUnavailable = false,
  actorPermissionCodes,
  isSubmitting,
  emailError,
  formError,
  onSubmit,
  onCancel,
}: UserFormProps) {
  const { t, i18n } = useTranslation();

  const defaultValues = React.useMemo<UserFormValues>(
    () => ({
      email: user?.email ?? "",
      firstName: user?.firstName ?? "",
      lastNamePaternal: user?.lastNamePaternal ?? "",
      lastNameMaternal: user?.lastNameMaternal ?? undefined,
      locale:
        (user?.locale as "es" | "en" | undefined) ?? (i18n.language.startsWith("en") ? "en" : "es"),
      roleIds: user?.roles.map((role) => role.id) ?? [],
    }),
    [user, i18n.language],
  );

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues,
  });

  const selectedRoleIds = watch("roleIds") ?? [];

  function toggleRole(roleId: string, checked: boolean) {
    const next = checked
      ? [...selectedRoleIds, roleId]
      : selectedRoleIds.filter((id) => id !== roleId);
    setValue("roleIds", next, { shouldValidate: true });
  }

  const submit = handleSubmit((values) => onSubmit(values));

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {t(mode === "create" ? "users.form.createTitle" : "users.form.editTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {formError && (
            <p
              role="alert"
              data-testid="user-form-error"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}
          <TextField
            label={t("users.form.email")}
            type="email"
            autoComplete="email"
            disabled={mode === "edit"}
            error={errors.email?.message ? t(errors.email.message) : (emailError ?? undefined)}
            {...register("email")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t("users.form.firstName")}
              autoComplete="given-name"
              error={errors.firstName?.message ? t(errors.firstName.message) : undefined}
              {...register("firstName")}
            />
            <TextField
              label={t("users.form.lastNamePaternal")}
              autoComplete="family-name"
              error={
                errors.lastNamePaternal?.message ? t(errors.lastNamePaternal.message) : undefined
              }
              {...register("lastNamePaternal")}
            />
          </div>
          <TextField
            label={t("users.form.lastNameMaternal")}
            autoComplete="family-name"
            error={
              errors.lastNameMaternal?.message ? t(errors.lastNameMaternal.message) : undefined
            }
            {...register("lastNameMaternal")}
          />
          <SelectField
            label={t("users.form.locale")}
            options={[
              { value: "es", label: t("users.form.localeOptions.es") },
              { value: "en", label: t("users.form.localeOptions.en") },
            ]}
            {...register("locale")}
          />

          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{t("users.form.roles")}</legend>
            {rolesUnavailable ? (
              <p role="alert" className="text-xs text-destructive">
                {t("users.form.rolesUnavailable")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">{t("users.form.rolesHint")}</p>
            )}
            <div className="flex flex-col gap-2">
              {!rolesUnavailable &&
                roles.map((role) => {
                  const escalates = role.permissionCodes.some(
                    (code) => !actorPermissionCodes.includes(code),
                  );
                  const checked = selectedRoleIds.includes(role.id);
                  // Fix del desvío del batch 2: disabled ASIMÉTRICO (misma
                  // regla que D5). `assertNoRoleAssignmentEscalation` solo
                  // valida el delta AGREGADO — QUITARLE a alguien un rol que
                  // el actor no posee es legal en la API. Deshabilitarlo
                  // siempre sería más restrictivo que el backend y le
                  // impediría a un admin parcial arreglar una asignación
                  // indebida que ve en pantalla.
                  const disabled = escalates && !checked;
                  const inputId = `role-${role.id}`;
                  return (
                    <div key={role.id} className="flex items-center gap-2">
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={(next) => toggleRole(role.id, next === true)}
                      />
                      <Label
                        htmlFor={inputId}
                        className={disabled ? "text-muted-foreground" : undefined}
                        title={disabled ? t("users.form.roleEscalationHint") : undefined}
                      >
                        {role.name}
                      </Label>
                    </div>
                  );
                })}
            </div>
            {errors.roleIds?.message && (
              <p role="alert" className="text-xs text-destructive">
                {t(errors.roleIds.message)}
              </p>
            )}
          </fieldset>

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("common.form.submitting")
                : t(mode === "create" ? "users.form.submitCreate" : "users.form.submitEdit")}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("common.form.cancel")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export { UserForm };
