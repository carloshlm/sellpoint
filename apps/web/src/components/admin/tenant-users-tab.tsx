import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useReactivateTenantUser, useSuspendTenantUser, useTenantUsers } from "@/lib/admin/hooks";
import type { ApiError } from "@/lib/api";

const TONO: Record<string, "default" | "success" | "warning"> = {
  active: "success",
  invited: "warning",
  suspended: "default",
};

/**
 * F9-ADMIN-08 — los usuarios del negocio, con suspender y reactivar desde el
 * backoffice. Una tabla propia y compacta: la de `/system/users` trae
 * invitaciones, alcance de almacenes y edición, que acá no aplican.
 */
export function TenantUsersTab({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const { data, isPending } = useTenantUsers(tenantId);
  const suspend = useSuspendTenantUser(tenantId);
  const reactivate = useReactivateTenantUser(tenantId);
  const [error, setError] = useState<string | null>(null);
  const onError = (apiError: ApiError) => setError(apiError.message);
  const k = (sufijo: string) => t(`common.billing.admin.tenants.users.${sufijo}`);

  if (isPending) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("common.form.loading")}
      </p>
    );
  }
  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-3" data-testid="tenant-users">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {error}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{k("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="px-2">{t("users.table.columns.name")}</TableHead>
              <TableHead className="px-2">{t("users.table.columns.email")}</TableHead>
              <TableHead className="px-2">{t("users.table.columns.roles")}</TableHead>
              <TableHead className="px-2">{t("users.table.columns.status")}</TableHead>
              <TableHead className="px-2" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((user) => (
              <TableRow key={user.id} data-testid={`tenant-user-${user.id}`}>
                <TableCell className="px-2 font-medium">
                  {[user.firstName, user.lastNamePaternal, user.lastNameMaternal]
                    .filter(Boolean)
                    .join(" ")}
                </TableCell>
                <TableCell className="px-2">{user.email}</TableCell>
                <TableCell className="px-2">{user.roles.map((r) => r.name).join(", ")}</TableCell>
                <TableCell className="px-2">
                  <Badge variant={TONO[user.status] ?? "default"}>
                    {t(`users.table.status.${user.status}`)}
                  </Badge>
                </TableCell>
                <TableCell className="px-2 text-right">
                  {user.status === "suspended" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={reactivate.isPending}
                      onClick={() => {
                        setError(null);
                        reactivate.mutate(user.id, { onError });
                      }}
                    >
                      {k("reactivate")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={suspend.isPending}
                      onClick={() => {
                        setError(null);
                        suspend.mutate(user.id, { onError });
                      }}
                    >
                      {k("suspend")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
