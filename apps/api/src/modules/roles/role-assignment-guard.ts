import { ForbiddenException } from "@nestjs/common";
import type { AuthUser } from "../auth/types/auth-user";

export interface RoleWithPermissionCodes {
  id: string;
  permissionCodes: readonly string[];
}

/**
 * W1b (hardening post-verify #274 pasada 2, `sdd/f1-rbac/verify-report`):
 * confused deputy por ASIGNACIÓN de roles, no por acuñación. W1
 * (`RolesService.assertNoPrivilegeEscalation`) impide otorgarle a un rol un
 * permiso que el actor no posee — pero nada impedía que el actor tomara un
 * rol EXISTENTE que ya reúne permisos que él mismo no tiene, vía
 * `UsersAdminService.create()`/`update()` (`roleIds`).
 *
 * Regla: al asignar roles a un usuario, el actor debe poseer TODOS los
 * permisos efectivos de los roles que agrega. Se evalúa contra la UNIÓN de
 * permisos de los roles AGREGADOS (delta positivo) — sacarle a alguien
 * roles que ya tenía NO es escalada y sigue permitido sin pasar por acá.
 *
 * Reutiliza el criterio de `RolesService.assertNoPrivilegeEscalation` pero
 * vive en `modules/roles/` (mismo import cruzado de función pura que
 * `tenant-admin-guard.ts`) porque el caller (`UsersAdminService`) no tiene
 * acceso directo a los permission codes de un rol sin resolverlos primero.
 */
export function assertNoRoleAssignmentEscalation(
  actor: AuthUser,
  addedRoles: readonly RoleWithPermissionCodes[],
): void {
  if (addedRoles.length === 0) {
    return;
  }

  const actorPermissions = new Set(actor.permissions);
  const hasUnheldPermission = addedRoles.some((role) =>
    role.permissionCodes.some((code) => !actorPermissions.has(code)),
  );

  if (hasUnheldPermission) {
    throw new ForbiddenException({ message: "users.cannot_assign_unheld_role_permission" });
  }
}
