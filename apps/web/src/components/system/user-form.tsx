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

/** Lo mínimo que el checklist necesita — no el `Warehouse` entero. */
interface WarehouseOption {
  id: string;
  name: string;
}

interface UserFormProps {
  mode: "create" | "edit";
  /** Requerido en `mode: "edit"` — precarga el form (F1-WEB-USERS-03). */
  user?: UserDetail;
  roles: RoleSummary[];
  /** W1: true si el catálogo de roles no se pudo cargar (sin `roles:read` o error de red) — reemplaza el checklist por un mensaje explicando por qué. */
  rolesUnavailable?: boolean;
  /** Permisos del ACTOR (no del usuario editado) — alimenta D8. */
  actorPermissionCodes: string[];
  /**
   * F3-NAV-03. Los almacenes del tenant para el checklist de alcance. En
   * `mode: "create"` no se pasa: el endpoint necesita un `:id` que todavía no
   * existe (ver el comentario de la sección).
   */
  warehouses?: WarehouseOption[];
  /** Ids que el usuario YA tiene. Vacío = sin restricción (default permisivo). */
  warehouseScope?: string[];
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
  warehouses,
  warehouseScope,
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
      warehouseIds: warehouseScope ?? [],
      defaultWarehouseId: user?.defaultWarehouseId ?? "",
    }),
    [user, i18n.language, warehouseScope],
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

  const selectedWarehouseIds = watch("warehouseIds") ?? [];

  /**
   * F3-NAV-03. Quién "ve todos los almacenes pase lo que pase". Se deriva de
   * los PERMISOS de los roles marcados AHORA mismo, no del nombre del rol ni
   * de `user.roles`:
   *
   * - por permisos y no por nombre, porque es el MISMO criterio que usa el
   *   API (`TENANT_ADMIN_PERMISSION_CODES` en `tenant-admin-guard.ts`, que el
   *   interceptor de alcance reutiliza para el bypass). Atarse al nombre
   *   "Admin" rompería con un rol renombrado o traducido;
   * - de lo marcado y no de lo guardado, porque si no la pantalla mentiría
   *   hasta el próximo refresh: marcás el rol que da acceso total y la lista
   *   de almacenes seguiría ofreciendo una restricción que ya no va a existir.
   */
  const TENANT_ADMIN_PERMISSION_CODES = ["roles:manage", "users:manage"];
  const grantedPermissionCodes = new Set(
    roles.filter((role) => selectedRoleIds.includes(role.id)).flatMap((r) => r.permissionCodes),
  );
  const seesAllWarehouses = TENANT_ADMIN_PERMISSION_CODES.every((code) =>
    grantedPermissionCodes.has(code),
  );

  function toggleWarehouse(warehouseId: string, checked: boolean) {
    const next = checked
      ? [...selectedWarehouseIds, warehouseId]
      : selectedWarehouseIds.filter((id) => id !== warehouseId);
    setValue("warehouseIds", next, { shouldValidate: true });
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

          {/*
            F3-HOME-02. El almacén ASIGNADO: uno solo, desde el que opera por
            defecto. Distinto del ALCANCE de abajo (una lista de dónde PUEDE
            operar). A diferencia del alcance, esto SÍ está en el alta: es una
            columna del usuario, no otro recurso, así que viaja en el mismo POST
            y no puede quedar a medio aplicar.

            Las opciones fuera del alcance MARCADO se deshabilitan: el API las
            rechaza con 409 y hacer chocar al usuario contra eso sería ofrecerle
            algo que no va a funcionar.
          */}
          {warehouses && (
            <div className="flex flex-col gap-1">
              <SelectField
                label={t("users.form.defaultWarehouse")}
                options={[
                  { value: "", label: t("users.form.defaultWarehouseNone") },
                  ...warehouses.map((warehouse) => ({
                    value: warehouse.id,
                    label: warehouse.name,
                    disabled:
                      selectedWarehouseIds.length > 0 &&
                      !selectedWarehouseIds.includes(warehouse.id),
                  })),
                ]}
                {...register("defaultWarehouseId")}
              />
              <p className="text-muted-foreground text-xs" data-testid="default-warehouse-hint">
                {t("users.form.defaultWarehouseHint")}
              </p>
            </div>
          )}

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

          {/*
            El checklist solo existe en edición: `PUT /users/:id/warehouse-scope`
            necesita un id, y el usuario nace recién al guardar. Encadenar las
            dos llamadas en el alta dejaría un usuario creado con el alcance sin
            aplicar si la segunda falla — una escritura parcial sin transacción.
          */}
          {mode === "edit" && warehouses && (
            <fieldset className="flex flex-col gap-2" data-testid="user-form-warehouse-scope">
              <legend className="text-sm font-medium">{t("users.form.warehouseScope")}</legend>
              {seesAllWarehouses ? (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="warehouse-scope-admin-hint"
                >
                  {t("users.form.warehouseScopeAdminHint")}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("users.form.warehouseScopeHint")}
                </p>
              )}
              <div className="flex flex-col gap-2">
                {warehouses.map((warehouse) => {
                  const inputId = `warehouse-scope-${warehouse.id}`;
                  return (
                    <div key={warehouse.id} className="flex items-center gap-2">
                      <Checkbox
                        id={inputId}
                        data-testid={inputId}
                        checked={selectedWarehouseIds.includes(warehouse.id)}
                        disabled={seesAllWarehouses}
                        onCheckedChange={(next) => toggleWarehouse(warehouse.id, next === true)}
                      />
                      <Label
                        htmlFor={inputId}
                        className={seesAllWarehouses ? "text-muted-foreground" : undefined}
                      >
                        {warehouse.name}
                      </Label>
                    </div>
                  );
                })}
              </div>
              {/*
                Vacío NO es "no ve nada": sin filas el API le da todos los
                almacenes. Decirlo es obligatorio — quien desmarca todo tiene
                que saber que acaba de AMPLIAR el acceso, no de quitarlo.
              */}
              {!seesAllWarehouses && selectedWarehouseIds.length === 0 && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="warehouse-scope-empty-hint"
                >
                  {t("users.form.warehouseScopeEmptyHint")}
                </p>
              )}
            </fieldset>
          )}

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
