import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { UserForm } from "@/components/system/user-form";
import { fullName, UsersTable } from "@/components/system/users-table";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import { useForgotPassword } from "@/lib/auth/hooks";
import { usePermissions } from "@/lib/auth/permissions";
import type { UserDetail } from "@/lib/rbac/api";
import {
  useCreateUser,
  useReactivateUser,
  useResendInvitation,
  useRoles,
  useSuspendUser,
  useUpdateUser,
  useUsers,
} from "@/lib/rbac/hooks";
import type { UserFormValues } from "@/lib/rbac/schemas";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/system/users")({
  component: SystemUsersPage,
});

/**
 * F1-WEB-USERS-01. Lista completa del tenant (`GET /users`, sin paginar en
 * servidor — decisión del proposal: server-side "cuando duela"). Gate por
 * `users:read` (D2); `canManage` viaja como PROP a `UsersTable` (D1) para
 * reservar la columna "Acciones" (menú `⋮`, F1-WEB-USERS-04, WU5, Batch 3).
 */
function SystemUsersPage() {
  return (
    <ProtectedRoute>
      <AppLayout>
        <PermissionGate need="users:read">
          <SystemUsersContent />
        </PermissionGate>
      </AppLayout>
    </ProtectedRoute>
  );
}

type FormState = { mode: "create" } | { mode: "edit"; user: UserDetail };

/**
 * F1-WEB-USERS-02/03 (Batch 2). Alta/edición viven en este container: el
 * form (`UserForm`) es presentacional puro, el wiring de mutaciones y el
 * mapeo del 409 `users.email_taken` a error de campo viven acá.
 *
 * `useRoles({ enabled: canManage })`: pedir el catálogo de roles sin
 * `users:manage` sería la request inútil que S6 (f1-web-auth) mandó evitar
 * — un actor solo-lectura nunca ve el form que la necesita.
 */
function SystemUsersContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const canManage = has("users:manage");
  const actorPermissionCodes = useAuthStore((state) => state.user?.permissions ?? []);

  const { data, isPending, isError } = useUsers();
  const { data: roles } = useRoles({ enabled: canManage });
  const createUserMutation = useCreateUser();
  const updateUserMutation = useUpdateUser();
  const suspendUserMutation = useSuspendUser();
  const reactivateUserMutation = useReactivateUser();
  const resendInvitationMutation = useResendInvitation();
  const forgotPasswordMutation = useForgotPassword();
  const actorId = useAuthStore((state) => state.user?.id ?? "");

  const [formState, setFormState] = useState<FormState | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  function openCreate() {
    setEmailError(null);
    setFormError(null);
    setConfirmation(null);
    setActionFeedback(null);
    setFormState({ mode: "create" });
  }

  function openEdit(user: UserDetail) {
    setEmailError(null);
    setFormError(null);
    setConfirmation(null);
    setActionFeedback(null);
    setFormState({ mode: "edit", user });
  }

  function closeForm() {
    setFormState(null);
  }

  function handleApiError(error: ApiError) {
    if (error.code === "users.email_taken") {
      setEmailError(error.message);
      return;
    }
    setFormError(error.statusCode === 0 ? t("common.errors.network") : error.message);
  }

  function handleSubmit(values: UserFormValues) {
    if (!formState) return;
    setEmailError(null);
    setFormError(null);

    if (formState.mode === "create") {
      createUserMutation.mutate(values, {
        onSuccess: () => {
          setFormState(null);
          setConfirmation(t("users.form.createSuccess", { email: values.email }));
        },
        onError: handleApiError,
      });
      return;
    }

    const { email: _email, ...input } = values;
    updateUserMutation.mutate(
      { id: formState.user.id, input },
      {
        onSuccess: () => {
          setFormState(null);
        },
        onError: handleApiError,
      },
    );
  }

  const isSubmitting = createUserMutation.isPending || updateUserMutation.isPending;

  /**
   * Errores de las acciones de fila (suspender/reactivar/reenviar): el 409 se
   * muestra como banner sin desmontar la tabla (D10) — los prevenibles ya
   * están evitados client-side por `UserRowActions`, esto es la red de
   * seguridad si igual llegan (p. ej. un cambio de estado concurrente).
   */
  function handleActionError(error: ApiError) {
    setActionFeedback({
      type: "error",
      message: error.statusCode === 0 ? t("common.errors.network") : error.message,
    });
  }

  function handleSuspend(user: UserDetail) {
    setActionFeedback(null);
    suspendUserMutation.mutate(user.id, {
      onSuccess: () =>
        setActionFeedback({
          type: "success",
          message: t("users.actions.suspendSuccess", { name: fullName(user) }),
        }),
      onError: handleActionError,
    });
  }

  function handleReactivate(user: UserDetail) {
    setActionFeedback(null);
    reactivateUserMutation.mutate(user.id, {
      onSuccess: () =>
        setActionFeedback({
          type: "success",
          message: t("users.actions.reactivateSuccess", { name: fullName(user) }),
        }),
      onError: handleActionError,
    });
  }

  function handleResendInvitation(user: UserDetail) {
    setActionFeedback(null);
    resendInvitationMutation.mutate(user.id, {
      onSuccess: () =>
        setActionFeedback({
          type: "success",
          message: t("users.actions.resendInvitationSuccess", { name: fullName(user) }),
        }),
      onError: handleActionError,
    });
  }

  /**
   * Reusa el endpoint público `POST /auth/forgot-password` (D del proposal:
   * sin endpoint admin nuevo). Responde 202 anti-enumeración SIEMPRE — el
   * copy de éxito NUNCA confirma que el correo existe, ni acá ni en
   * `/forgot-password` (mismo criterio que `auth.forgot.successBody`).
   */
  function handleResetPassword(user: UserDetail) {
    setActionFeedback(null);
    forgotPasswordMutation.mutate(user.email, {
      onSuccess: () =>
        setActionFeedback({ type: "success", message: t("users.actions.resetPasswordSuccess") }),
      onError: handleActionError,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold" data-testid="system-users-title">
            {t("users.page.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("users.page.subtitle")}</p>
        </div>
        {canManage && !formState && (
          <Button type="button" onClick={openCreate}>
            {t("users.form.newUser")}
          </Button>
        )}
      </div>
      {confirmation && (
        <p
          role="status"
          data-testid="user-form-confirmation"
          className="rounded-md bg-success-soft px-3 py-2 text-sm text-success"
        >
          {confirmation}
        </p>
      )}
      {actionFeedback && (
        <p
          role={actionFeedback.type === "error" ? "alert" : "status"}
          data-testid="user-action-feedback"
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            actionFeedback.type === "error"
              ? "bg-destructive/10 text-destructive"
              : "bg-success-soft text-success",
          )}
        >
          {actionFeedback.message}
        </p>
      )}
      {isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("users.table.loading")}
        </p>
      )}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          {t("users.table.error")}
        </p>
      )}
      {formState && canManage && (
        <UserForm
          // C1 (verify-report #341): sin `key`, React reconcilia la MISMA
          // instancia del form al cambiar de fila (Ana → Beto sin cerrar) y
          // react-hook-form ignora el cambio de `defaultValues` — el PATCH
          // termina llevando los datos y roleIds del usuario ANTERIOR. La
          // `key` fuerza un remount (y por lo tanto un `useForm` nuevo) cada
          // vez que cambia el modo o el usuario editado.
          key={formState.mode === "edit" ? formState.user.id : "create"}
          mode={formState.mode}
          user={formState.mode === "edit" ? formState.user : undefined}
          roles={roles ?? []}
          actorPermissionCodes={actorPermissionCodes}
          isSubmitting={isSubmitting}
          emailError={emailError}
          formError={formError}
          onSubmit={handleSubmit}
          onCancel={closeForm}
        />
      )}
      {data && (
        <UsersTable
          users={data}
          canManage={canManage}
          actorId={actorId}
          onEdit={openEdit}
          onSuspend={handleSuspend}
          onReactivate={handleReactivate}
          onResendInvitation={handleResendInvitation}
          onResetPassword={handleResetPassword}
        />
      )}
    </div>
  );
}
