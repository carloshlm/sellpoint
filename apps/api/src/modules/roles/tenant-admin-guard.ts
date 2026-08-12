import { ConflictException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";

/**
 * Hardening W2 (verify #274 de F1-RBAC, `sdd/f1-rbac/verify-report`):
 * invariante dura para que un tenant NUNCA quede en lockout permanente
 * (nadie que pueda administrar usuarios/roles, sin recuperación por API).
 *
 * Un tenant SIEMPRE debe conservar al menos un rol con AMBOS
 * `roles:manage` y `users:manage` asignado a al menos un usuario ACTIVO
 * (no `invited` ni `suspended`). Se llama DENTRO de la misma tx de dominio
 * que muta permisos de rol / roles de usuario / status de usuario,
 * DESPUÉS de aplicar la mutación — si la invariante se rompe, tira 409 y
 * Prisma hace rollback automático de la tx completa (mismo mecanismo que
 * cualquier otra excepción lanzada dentro de `withTenantContext`).
 *
 * Vive acá (módulo `roles`) porque es una propiedad de la COMPOSICIÓN de
 * roles/permisos, aunque `UsersAdminService` también la invoque (mutar
 * `roleIds`/`status` de un usuario puede romperla igual que mutar un rol)
 * — import cruzado de función pura, no de un provider, así que no hay
 * ciclo de módulos NestJS.
 */
export const TENANT_ADMIN_PERMISSION_CODES = ["roles:manage", "users:manage"] as const;

export async function assertTenantRetainsAdmin(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  const roles = await tx.role.findMany({
    where: { tenantId },
    select: {
      permissions: { select: { permission: { select: { code: true } } } },
      users: { select: { user: { select: { status: true } } } },
    },
  });

  const hasActiveAdmin = roles.some((role) => {
    const codes = new Set(role.permissions.map((p) => p.permission.code));
    const isAdminRole = TENANT_ADMIN_PERMISSION_CODES.every((code) => codes.has(code));
    if (!isAdminRole) {
      return false;
    }
    return role.users.some((userRole) => userRole.user.status === "active");
  });

  if (!hasActiveAdmin) {
    throw new ConflictException({ message: "roles.last_admin_protected" });
  }
}
