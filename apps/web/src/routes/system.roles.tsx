import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { TextField } from "@/components/form/text-field";
import { AppLayout } from "@/components/layout/app-layout";
import { PermissionChecklist } from "@/components/system/permission-checklist";
import { RoleList } from "@/components/system/role-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ApiError } from "@/lib/api";
import { usePermissions } from "@/lib/auth/permissions";
import type { RoleSummary } from "@/lib/rbac/api";
import {
  useCreateRole,
  useDeleteRole,
  usePermissionsCatalog,
  useRoles,
  useUpdateRole,
} from "@/lib/rbac/hooks";
import { type RoleFormValues, roleFormSchema } from "@/lib/rbac/schemas";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/system/roles")({
  component: SystemRolesPage,
});

/**
 * F1-WEB-USERS-05. Sidebar de roles + editor de permisos. Gate por
 * `roles:read` (D2); `canManage` viaja como PROP a `RoleList`/
 * `PermissionChecklist` (D1) — nunca leen el store directo.
 */
function SystemRolesPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="roles:read">
            <SystemRolesContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function SystemRolesContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const canManage = has("roles:manage");
  const actorPermissionCodes = useAuthStore((state) => state.user?.permissions ?? []);

  const { data: roles } = useRoles();
  const { data: catalog } = usePermissionsCatalog();
  const createRoleMutation = useCreateRole();
  const updateRoleMutation = useUpdateRole();
  const deleteRoleMutation = useDeleteRole();

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // S2 (verify-report #341): updateRoleSchema/roleFormSchema aceptan `name`,
  // pero el editor solo mandaba `permissionCodes` — el nombre quedaba
  // congelado en la creación. Draft local, mismo criterio que `selected`.
  const [nameDraft, setNameDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<RoleSummary | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const selectedRole = roles?.find((role) => role.id === selectedRoleId) ?? null;

  function resetFeedback() {
    setSaveError(null);
    setSaveSuccess(null);
    setDeleteError(null);
    setDeleteSuccess(null);
    setCreateError(null);
    setCreateSuccess(null);
  }

  function handleSelect(roleId: string) {
    const role = roles?.find((candidate) => candidate.id === roleId);
    resetFeedback();
    setCreating(false);
    setSelectedRoleId(roleId);
    setSelected(new Set(role?.permissionCodes ?? []));
    setNameDraft(role?.name ?? "");
  }

  function handleToggle(code: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(code);
      } else {
        next.delete(code);
      }
      return next;
    });
  }

  function apiErrorMessage(error: ApiError): string {
    return error.statusCode === 0 ? t("common.errors.network") : error.message;
  }

  function handleSave() {
    if (!selectedRole) return;
    resetFeedback();
    const name = nameDraft.trim();
    updateRoleMutation.mutate(
      { id: selectedRole.id, input: { name, permissionCodes: Array.from(selected) } },
      {
        onSuccess: () => {
          setSaveSuccess(t("users.roles.editor.saveSuccess", { name }));
        },
        onError: (error) => setSaveError(apiErrorMessage(error)),
      },
    );
  }

  function handleCancel() {
    if (selectedRole) {
      setSelected(new Set(selectedRole.permissionCodes));
      setNameDraft(selectedRole.name);
    }
    resetFeedback();
  }

  /**
   * La confirmación era un `window.confirm`: no se puede traducir con el resto
   * del sistema, no se puede estilar y bloquea el hilo del navegador. Se
   * reemplazó por el `ConfirmDialog` que usan los demás borrados.
   */
  function handleDelete(role: RoleSummary) {
    resetFeedback();
    deleteRoleMutation.mutate(role.id, {
      onSuccess: () => {
        if (role.id === selectedRoleId) {
          setSelectedRoleId(null);
          setSelected(new Set());
        }
        // W3 (verify-report #341): eliminar un rol no daba feedback de
        // éxito — misma clave i18n que ya existía, 0 usos.
        setDeleteSuccess(t("users.roles.deleteSuccess", { name: role.name }));
        setPendingRemoval(null);
      },
      onError: (error) => {
        setPendingRemoval(null);
        setDeleteError(apiErrorMessage(error));
      },
    });
  }

  function handleCreate() {
    resetFeedback();
    setSelectedRoleId(null);
    setCreating(true);
  }

  function handleCancelCreate() {
    resetFeedback();
    setCreating(false);
  }

  function handleCreateSubmit(values: RoleFormValues) {
    resetFeedback();
    createRoleMutation.mutate(
      { name: values.name, permissionCodes: values.permissionCodes ?? [] },
      {
        onSuccess: (role) => {
          setCreating(false);
          setSelectedRoleId(role.id);
          setSelected(new Set(role.permissionCodes));
          // W6 (verify-report pasada 2, introducido por S2): misma clase de
          // bug que C1 — el editor pasa a mostrar el rol RECIÉN CREADO, así
          // que `nameDraft` tiene que resembrarse acá también, no solo en
          // `handleSelect`. Sin esto, `handleSave` mandaba el nombre del
          // rol seleccionado ANTES de crear (o vacío si no había ninguno).
          setNameDraft(role.name);
          // W3 (verify-report #341): crear un rol no daba feedback de éxito —
          // misma clave i18n que ya existía, 0 usos.
          setCreateSuccess(t("users.roles.form.createSuccess", { name: role.name }));
        },
        onError: (error) => setCreateError(apiErrorMessage(error)),
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="system-roles-title">
          {t("users.roles.page.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("users.roles.page.subtitle")}</p>
      </div>

      {deleteError && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {deleteError}
        </p>
      )}
      {deleteSuccess && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {deleteSuccess}
        </p>
      )}

      {pendingRemoval && (
        <ConfirmDialog
          data-testid="remove-role-dialog"
          title={t("users.roles.removeDialog.title")}
          body={t("users.roles.removeDialog.body", { name: pendingRemoval.name })}
          confirmLabel={t("users.roles.removeDialog.confirm")}
          cancelLabel={t("common.form.cancel")}
          busy={deleteRoleMutation.isPending}
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => handleDelete(pendingRemoval)}
        />
      )}

      {/* Sobre tarjeta, como Mi perfil (Carlos, 2026-08-25): la lista y el
          editor pintaban sus controles directo sobre el fondo. `self-start`:
          cada tarjeta mide su contenido, no la altura de la otra columna. */}
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <Card className="self-start">
          <CardContent className="py-4">
            <RoleList
              roles={roles ?? []}
              selectedRoleId={selectedRoleId}
              canManage={canManage}
              onSelect={handleSelect}
              onDelete={setPendingRemoval}
              onCreate={handleCreate}
            />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          {creating && canManage && (
            <RoleCreateForm
              isSubmitting={createRoleMutation.isPending}
              formError={createError}
              onSubmit={handleCreateSubmit}
              onCancel={handleCancelCreate}
            />
          )}

          {!creating && selectedRole && (
            <Card>
              <CardContent className="flex flex-col gap-4 py-6">
                {canManage ? (
                  // S2: editor de nombre — mismo TextField que RoleCreateForm,
                  // sin schema/RHF de por medio (no hay validación async, un
                  // solo campo controlado alcanza).
                  <TextField
                    label={t("users.roles.form.name")}
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                  />
                ) : (
                  <h2 className="text-lg font-semibold">{selectedRole.name}</h2>
                )}
                {!canManage && (
                  <p className="text-sm text-muted-foreground">
                    {t("users.roles.editor.readOnlyHint")}
                  </p>
                )}
                {saveError && (
                  <p
                    role="alert"
                    className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {saveError}
                  </p>
                )}
                {saveSuccess && (
                  <p
                    role="status"
                    className="rounded-md bg-success-soft px-3 py-2 text-sm text-success"
                  >
                    {saveSuccess}
                  </p>
                )}
                {createSuccess && (
                  <p
                    role="status"
                    className="rounded-md bg-success-soft px-3 py-2 text-sm text-success"
                  >
                    {createSuccess}
                  </p>
                )}
                <PermissionChecklist
                  groups={catalog ?? []}
                  baselinePermissionCodes={selectedRole.permissionCodes}
                  actorPermissionCodes={actorPermissionCodes}
                  selected={selected}
                  onToggle={handleToggle}
                  readOnly={!canManage}
                />
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      onClick={handleSave}
                      disabled={updateRoleMutation.isPending || nameDraft.trim() === ""}
                    >
                      {t("users.roles.editor.save")}
                    </Button>
                    <Button type="button" variant="outline" onClick={handleCancel}>
                      {t("users.roles.editor.cancel")}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!creating && !selectedRole && (
            <p className="text-sm text-muted-foreground">{t("users.roles.editor.selectHint")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Crear rol (F1-WEB-USERS-05, open question del design: incluido en WU6). El
 * rol nace SIN permisos (`roleFormSchema` los acepta vacíos "rol recién
 * creado") — se le asignan seleccionándolo en la lista y usando el checklist.
 */
function RoleCreateForm({
  isSubmitting,
  formError,
  onSubmit,
  onCancel,
}: {
  isSubmitting: boolean;
  formError?: string | null;
  onSubmit: (values: RoleFormValues) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(roleFormSchema),
    defaultValues: { name: "", permissionCodes: [] as string[] },
  });

  // `permissionCodes` tiene `.default([])` en el schema (zod v4): el tipo de
  // ENTRADA que infiere `zodResolver` lo deja opcional, aunque la SALIDA
  // parseada (`RoleFormValues`) siempre lo trae como array — de ahí el `?? []`.
  const submit = handleSubmit((values) =>
    onSubmit({ name: values.name, permissionCodes: values.permissionCodes ?? [] }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("users.roles.form.createTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {formError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </p>
          )}
          <TextField
            label={t("users.roles.form.name")}
            error={errors.name?.message ? t(errors.name.message) : undefined}
            {...register("name")}
          />
          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("common.form.submitting") : t("users.roles.form.submitCreate")}
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
