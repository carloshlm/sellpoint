import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { UsersTable } from "@/components/system/users-table";
import { usePermissions } from "@/lib/auth/permissions";
import { useUsers } from "@/lib/rbac/hooks";

export const Route = createFileRoute("/system/users")({
  component: SystemUsersPage,
});

/**
 * F1-WEB-USERS-01. Solo lectura en este batch: la lista completa del tenant
 * (`GET /users`, sin paginar en servidor — decisión del proposal: server-side
 * "cuando duela"). Gate por `users:read` (D2); `canManage` viaja como PROP a
 * `UsersTable` (D1) para reservar la columna "Acciones" que llenan WU4/WU5.
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

function SystemUsersContent() {
  const { t } = useTranslation();
  const { has } = usePermissions();
  const { data, isPending, isError } = useUsers();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="system-users-title">
          {t("users.page.title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("users.page.subtitle")}</p>
      </div>
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
      {data && <UsersTable users={data} canManage={has("users:manage")} />}
    </div>
  );
}
