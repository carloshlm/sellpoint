import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { RoleSummary } from "@/lib/rbac/api";
import { cn } from "@/lib/utils";

interface RoleListProps {
  roles: RoleSummary[];
  selectedRoleId: string | null;
  /** Gatea "Nuevo rol" y "Eliminar" — solo lectura sin `roles:manage` (D del cross-cutting requirement). */
  canManage: boolean;
  onSelect: (roleId: string) => void;
  onDelete: (role: RoleSummary) => void;
  onCreate: () => void;
}

/**
 * F1-WEB-USERS-05 (WU6). Sidebar de roles del tenant. "Eliminar" deshabilitado
 * cuando `userCount > 0` (design: tabla "Borrar rol") — previene client-side
 * el 409 `roles.role_in_use` en vez de dejar que rompa el guardado.
 */
function RoleList({
  roles,
  selectedRoleId,
  canManage,
  onSelect,
  onDelete,
  onCreate,
}: RoleListProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <Button type="button" variant="outline" size="sm" onClick={onCreate}>
          {t("users.roles.list.newRole")}
        </Button>
      )}
      <ul className="flex flex-col gap-1">
        {roles.length === 0 && (
          <li className="px-2 py-1 text-sm text-muted-foreground">{t("users.roles.list.empty")}</li>
        )}
        {roles.map((role) => {
          const inUse = role.userCount > 0;
          return (
            <li key={role.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(role.id)}
                aria-current={role.id === selectedRoleId ? "true" : undefined}
                className={cn(
                  "flex-1 truncate rounded-md px-3 py-2 text-left text-sm font-medium hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  role.id === selectedRoleId && "bg-muted text-foreground",
                )}
              >
                {role.name}
              </button>
              {canManage && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={inUse}
                  title={inUse ? t("users.roles.list.deleteInUseHint") : undefined}
                  onClick={() => onDelete(role)}
                >
                  {t("users.roles.list.delete")}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { RoleList };
