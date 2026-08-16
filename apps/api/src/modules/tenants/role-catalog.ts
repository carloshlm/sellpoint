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
//
// CONVENCIÓN DE NOMBRES (decisión de Carlos, 2026-08-16): **PascalCase**.
// `POS_Seller` es la ÚNICA excepción y tiene motivo: el guion bajo separa un
// ACRÓNIMO de una palabra, porque `POSSeller` se lee mal. No es un estilo
// alternativo — un rol nuevo de dos palabras se llama `StockKeeper`, no
// `Stock_Keeper`. Se evaluó renombrar a `Tenant_Admin` para "seguir a
// POS_Seller" y se DESCARTÓ: dejaría dos de cuatro roles con guion bajo sin
// una regla que explique cuál lo lleva.
//
// Ojo si algún día se renombra igual: estos nombres son la columna
// `roles.name` en DB, no una etiqueta de UI (el front pinta lo que llega del
// API, no tiene i18n de roles). Un rename exige migración de datos para los
// tenants ya provisionados. Lo que NO se rompe es la autorización: por la ley
// de f1-scope, el bypass de TenantAdmin es por catálogo de permisos, nunca
// por nombre de rol.
export const TENANT_ROLE_NAMES = ["TenantAdmin", "Manager", "POS_Seller", "Viewer"] as const;

export type TenantRoleName = (typeof TENANT_ROLE_NAMES)[number];

// F1-WEB-ONBOARD-01 (D4 del design): configurar el negocio (razón social,
// dirección, moneda, onboarding) tampoco es tarea de Manager — mismo criterio
// que users:manage/roles:manage.
//
// F2-DB-10 suma `catalogs:manage`: definir la ESTRUCTURA del catálogo (qué
// campos existen, de qué tipo, qué lookups) cambia la forma de los datos de
// todo el negocio, no es operación diaria. El Manager sí carga y edita
// registros (`catalogs:write`) y productos (`products:manage`) — lo que no
// hace es rediseñar el molde.
//
// Ojo con la regla implícita de abajo: todo code que NO esté acá le cae a
// Manager automáticamente, y todo code terminado en `:read` le cae a Viewer.
// Agregar un permiso nuevo sin pensar en esta lista lo reparte solo.
const MANAGER_EXCLUDED_CODES = new Set([
  "users:manage",
  "roles:manage",
  "tenants:manage",
  "catalogs:manage",
]);
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
