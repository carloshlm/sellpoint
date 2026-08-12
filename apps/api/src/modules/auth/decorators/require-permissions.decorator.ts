import { SetMetadata } from "@nestjs/common";

export const PERMISSIONS_KEY = "requiredPermissions";

/**
 * Declara qué permisos exige un handler/controller (F1-RBAC-02). Los lee el
 * `PermissionsGuard` global, que corre DESPUÉS del `JwtAuthGuard` — o sea
 * que valida contra claims ya verificados (firma + epoch).
 *
 * Semántica AND: se exigen TODOS los codes listados.
 *
 *   @RequirePermissions("users:manage")
 *   @Patch(":id")
 *   suspend() { ... }
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
