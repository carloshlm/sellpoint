import { zodResolver } from "@hookform/resolvers/zod";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
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
      <AppLayout>
        <PermissionGate need="roles:read">
          <SystemRolesContent />
        </PermissionGate>
      </AppLayout>
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
  const [creating, setCreating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const selectedRole = roles?.find((role) => role.id === selectedRoleId) ?? null;

  function resetFeedback() {
    setSaveError(null);
    setSaveSuccess(null);
    setDeleteError(null);
    setCreateError(null);
  }

  function handleSelect(roleId: string) {
    const role = roles?.find((candidate) => candidate.id === roleId);
    resetFeedback();
    setCreating(false);
    setSelectedRoleId(roleId);
    setSelected(new Set(role?.permissionCodes ?? []));
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
    updateRoleMutation.mutate(
      { id: selectedRole.id, input: { permissionCodes: Array.from(selected) } },
      {
        onSuccess: () => {
          setSaveSuccess(t("users.roles.editor.saveSuccess", { name: selectedRole.name }));
        },
        onError: (error) => setSaveError(apiErrorMessage(error)),
      },
    );
  }

  function handleCancel() {
    if (selectedRole) {
      setSelected(new Set(selectedRole.permissionCodes));
    }
    resetFeedback();
  }

  function handleDelete(role: RoleSummary) {
    const confirmed = window.confirm(t("users.roles.deleteConfirm", { name: role.name }));
    if (!confirmed) return;
    resetFeedback();
    deleteRoleMutation.mutate(role.id, {
      onSuccess: () => {
        if (role.id === selectedRoleId) {
          setSelectedRoleId(null);
          setSelected(new Set());
        }
      },
      onError: (error) => setDeleteError(apiErrorMessage(error)),
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

      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        <RoleList
          roles={roles ?? []}
          selectedRoleId={selectedRoleId}
          canManage={canManage}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onCreate={handleCreate}
        />

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
            <div className="flex flex-col gap-4">
              <h2 className="text-lg font-semibold">{selectedRole.name}</h2>
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
                    disabled={updateRoleMutation.isPending}
                  >
                    {t("users.roles.editor.save")}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleCancel}>
                    {t("users.roles.editor.cancel")}
                  </Button>
                </div>
              )}
            </div>
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
