import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";

/**
 * F9-ADMIN-01 — el actor SINTÉTICO con el que el dueño de la plataforma lee
 * los datos de OTRO negocio.
 *
 * Los services de reportes y dashboard reciben `(user, scope)` y leen
 * `user.tenantId` por dentro; cambiar sus firmas tocaría ocho archivos y sus
 * specs, y perdería el gating por campo de `dashboard-inventory.service.ts`
 * (el valor del inventario solo viaja con `reports:read`). El menor cambio
 * seguro es un `AuthUser` cuyo tenant es el de la URL.
 *
 * ⚠ Este actor se apoya en que esos services leen `user.tenantId` y
 * `user.permissions`, y nada más. Un service futuro que filtre por
 * `user.userId` («mis ventas») devolvería datos vacíos o ajenos en silencio:
 * si aparece uno, hay que pasarle el tenant explícito, no confiar en esto.
 *
 * El alcance va LITERAL (`SCOPE_ALL`) y nunca por `@CurrentUserScope()`, que
 * resolvería los almacenes del admin en SU propio negocio.
 */
export function platformAdminActor(tenantId: string, admin: AuthUser): AuthUser {
  return {
    userId: admin.userId,
    tenantId,
    permissions: ["reports:read", "inventory:read"],
    locale: admin.locale,
  };
}

export const SCOPE_ALL: UserScope = { warehouseIds: "all" };
