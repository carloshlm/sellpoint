import { EllipsisVertical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UserDetail } from "@/lib/rbac/api";
import { fullName } from "./users-table";

interface UserRowActionsProps {
  user: UserDetail;
  /** id del actor autenticado — decide si "Suspender" aplica (no auto-suspensión). */
  actorId: string;
  onEdit: (user: UserDetail) => void;
  onSuspend: (user: UserDetail) => void;
  onReactivate: (user: UserDetail) => void;
  onResendInvitation: (user: UserDetail) => void;
  onResetPassword: (user: UserDetail) => void;
}

/**
 * F1-WEB-USERS-04 (WU5). Menú `⋮` por fila — absorbe el botón plano "Editar"
 * del batch 2. Reglas de visibilidad = tabla "Acciones de fila" del design
 * (D9): cada regla PREVIENE un 409 conocido en vez de solo manejarlo.
 * Presentacional puro: sin queries, la confirmación de "Suspender" es la
 * única lógica no trivial (acción destructiva — cierra sesiones del target).
 */
function UserRowActions({
  user,
  actorId,
  onEdit,
  onSuspend,
  onReactivate,
  onResendInvitation,
  onResetPassword,
}: UserRowActionsProps) {
  const { t } = useTranslation();

  const canSuspend = user.status === "active" && user.id !== actorId;
  const canReactivate = user.status === "suspended";
  const canResendInvitation = user.status === "invited";
  const canResetPassword = user.status === "active";

  function handleSuspend() {
    const confirmed = window.confirm(t("users.actions.confirmSuspend", { name: fullName(user) }));
    if (confirmed) onSuspend(user);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("users.actions.menuLabel")}
        >
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onEdit(user)}>{t("users.actions.edit")}</DropdownMenuItem>
        {canSuspend && (
          <DropdownMenuItem variant="destructive" onSelect={handleSuspend}>
            {t("users.actions.suspend")}
          </DropdownMenuItem>
        )}
        {canReactivate && (
          <DropdownMenuItem onSelect={() => onReactivate(user)}>
            {t("users.actions.reactivate")}
          </DropdownMenuItem>
        )}
        {canResendInvitation && (
          <DropdownMenuItem onSelect={() => onResendInvitation(user)}>
            {t("users.actions.resendInvitation")}
          </DropdownMenuItem>
        )}
        {canResetPassword && (
          <DropdownMenuItem onSelect={() => onResetPassword(user)}>
            {t("users.actions.resetPassword")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { UserRowActions };
