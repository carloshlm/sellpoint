// Roles base que TenantsService.provision() siembra para todo tenant
// nuevo (mismo set que prisma/seed.ts). f1-auth design §4: Admin,
// Manager, Seller, Viewer.
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
// `Seller` es la ÚNICA excepción y tiene motivo: el guion bajo separa un
// ACRÓNIMO de una palabra, porque `POSSeller` se lee mal. No es un estilo
// alternativo — un rol nuevo de dos palabras se llama `StockKeeper`, no
// `Stock_Keeper`. Se evaluó renombrar a `Tenant_Admin` para "seguir a
// Seller" y se DESCARTÓ: dejaría dos de cuatro roles con guion bajo sin
// una regla que explique cuál lo lleva.
//
// Ojo si algún día se renombra igual: estos nombres son la columna
// `roles.name` en DB, no una etiqueta de UI (el front pinta lo que llega del
// API, no tiene i18n de roles). Un rename exige migración de datos para los
// tenants ya provisionados. Lo que NO se rompe es la autorización: por la ley
// de f1-scope, el bypass de Admin es por catálogo de permisos, nunca
// por nombre de rol.
export const TENANT_ROLE_NAMES = ["Admin", "Manager", "Seller", "Viewer"] as const;

export type TenantRoleName = (typeof TENANT_ROLE_NAMES)[number];

/**
 * F2-CAT-01: identidad del Catálogo de Productos, el catálogo del sistema que
 * todo tenant tiene desde que nace.
 *
 * `PRODUCTS_CATALOG_KEY` es la clave ESTABLE contra la que el código pregunta
 * "¿cuál es el catálogo de productos de este tenant?" — nunca por nombre, que
 * el tenant puede cambiar. Vive acá y no en el service para que la migración
 * de backfill, el service y los tests hablen de lo mismo.
 */
export const PRODUCTS_CATALOG_KEY = "products";
export const PRODUCTS_CATALOG_NAME = "Catálogo de Productos";

/**
 * F3-HOME-03. El nombre del almacén con el que nace un tenant, por idioma del
 * owner. NEUTRO por LEY: sirve igual a una estética, un taller o un
 * consultorio, y un distribuidor lo renombra a "CEDIS" en un clic. A
 * diferencia del catálogo de productos, este nombre NO es de sistema — es una
 * sugerencia editable, no una referencia estable.
 */
export const INITIAL_WAREHOUSE_NAME: Record<"es" | "en", string> = {
  es: "Almacén Central",
  en: "Main Warehouse",
};

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
  // F3-DB-05: `inventory:manage` habilita las dos operaciones de inventario
  // que NO se deshacen solas — cancelar un traspaso (el stock ya salió del
  // origen y NO vuelve) y aprobar un inventario físico (reescribe el saldo
  // contra lo que alguien contó a mano). Mover mercancía es tarea diaria de
  // un Manager; decidir que un faltante se da por perdido, no.
  "inventory:manage",
]);
// F3-SVC-02: `services:read` entra acá porque el POS de F4 vende servicios
// además de mercancía, y sin leer el catálogo no habría qué vender. NO se le da
// `services:manage`: cambiar un precio no es tarea de mostrador.
//
// F4-DB-03 suma `pos:quote` y `pos:view`: el mostrador cotiza (una recepción
// puede tener SOLO `pos:quote` y cotizar sin poder cobrar — y el médico de F9
// hereda ese permiso sin caja) y ve su propio historial para reimprimir.
const POS_SELLER_CODES = new Set([
  "pos:sell",
  "pos:quote",
  "pos:view",
  "products:read",
  "services:read",
]);

/**
 * Codes de LECTURA que la regla del `:read` no alcanza.
 *
 * `pos:view` es un permiso de lectura pura —el historial de ventas— pero se
 * llama `:view` y no `:read`, así que `readCodes` lo dejaría fuera y un Viewer
 * (el auditor) no podría ver las ventas que vino a auditar. El nombre viene
 * documentado desde el diseño de VISTAS §9.3 y se respeta.
 *
 * **La deuda que esto deja anotada:** la convención del proyecto es
 * `recurso:read` para leer, y la regla automática se apoya en ella. Cada
 * permiso de lectura que se llame distinto necesita una línea acá — y el que
 * se olvide de agregarla no rompe nada visible, solo deja a un rol sin ver algo.
 * Si algún día se renombra a `pos:read`, esta lista queda vacía y la regla
 * vuelve a bastarse sola.
 */
const VIEWER_EXTRA_CODES = new Set(["pos:view"]);

/**
 * Dado el set de codes que EXISTE hoy en el catálogo global de permisos,
 * devuelve qué codes le corresponden a cada rol base. Función pura —
 * testeable sin DB.
 */
export function resolveRolePermissionCodes(
  allCodes: readonly string[],
): Record<TenantRoleName, string[]> {
  const readCodes = allCodes.filter(
    (code) => code.endsWith(":read") || VIEWER_EXTRA_CODES.has(code),
  );

  return {
    Admin: [...allCodes],
    Manager: allCodes.filter((code) => !MANAGER_EXCLUDED_CODES.has(code)),
    Seller: allCodes.filter((code) => POS_SELLER_CODES.has(code)),
    Viewer: readCodes,
  };
}

/**
 * El nombre PROVISIONAL de un tenant registrado sin nombre (2026-08-25): la
 * pantalla de registro ya no lo pide y el paso 1 del wizard lo reemplaza
 * SIEMPRE con el Nombre legal antes de operar. Por idioma del owner, mismo
 * criterio que INITIAL_WAREHOUSE_NAME.
 */
export const PROVISIONAL_TENANT_NAME: Record<"es" | "en", string> = {
  es: "Mi negocio",
  en: "My business",
};
