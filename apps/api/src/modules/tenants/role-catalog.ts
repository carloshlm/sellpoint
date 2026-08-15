// Roles base que TenantsService.provision() siembra para todo tenant
// nuevo (mismo set que prisma/seed.ts). f1-auth design §4: TenantAdmin,
// Manager, POS_Seller, Viewer.
//
// Los CODES de permisos exactos no se duplican acá — viven en el catálogo
// GLOBAL de la tabla `permissions` (poblado por prisma/seed.ts o, en el
// futuro, por una migración de f1-rbac). `resolveRolePermissionCodes()`
// aplica las mismas REGLAS de selección que el seed sobre el catálogo que
// exista en cada entorno: si el catálogo está vacío (dev/CI/prod sin seed
// corrido todavía), los roles nacen sin permisos — degradación aceptada,
// no bloqueante para AUTH-REQ-01 (f1-rbac es quien gestiona permisos).
export const TENANT_ROLE_NAMES = ["TenantAdmin", "Manager", "POS_Seller", "Viewer"] as const;

export type TenantRoleName = (typeof TENANT_ROLE_NAMES)[number];

// F1-WEB-ONBOARD-01 (D4 del design): configurar el negocio (razón social,
// dirección, moneda, onboarding) tampoco es tarea de Manager — mismo criterio
// que users:manage/roles:manage.
const MANAGER_EXCLUDED_CODES = new Set(["users:manage", "roles:manage", "tenants:manage"]);
const POS_SELLER_CODES = new Set(["pos:sell", "products:read"]);

/**
 * Dado el set de codes que EXISTE hoy en el catálogo global de permisos,
 * devuelve qué codes le corresponden a cada rol base. Función pura —
 * testeable sin DB.
 */
export function resolveRolePermissionCodes(
  allCodes: readonly string[],
): Record<TenantRoleName, string[]> {
  const readCodes = allCodes.filter((code) => code.endsWith(":read"));

  return {
    TenantAdmin: [...allCodes],
    Manager: allCodes.filter((code) => !MANAGER_EXCLUDED_CODES.has(code)),
    POS_Seller: allCodes.filter((code) => POS_SELLER_CODES.has(code)),
    Viewer: readCodes,
  };
}
