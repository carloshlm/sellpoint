// Roles de fábrica que TenantsService.provision() siembra para todo negocio
// nuevo (f1-auth design §4), en el orden en que nacen.
//
// Los CODES de permisos exactos no se duplican acá — viven en el catálogo
// GLOBAL de la tabla `permissions` (poblado por las migraciones de permisos
// y, en dev, por prisma/seed.ts). `resolveRolePermissionCodes()` aplica las
// REGLAS de reparto sobre el catálogo que exista en cada entorno: si está
// vacío, los roles nacen sin permisos — degradación aceptada, no bloqueante
// para AUTH-REQ-01 (f1-rbac es quien gestiona permisos).
//
// CONVENCIÓN (F10-MANFIX-22, Carlos, 2026-09-24): **clave fija + nombre en el
// idioma del negocio.** Reemplaza a la del 2026-08-16 (nombres en PascalCase
// y en inglés, que un negocio en español veía tal cual).
//
//  - La CLAVE (`key`, columna `roles.system_key`) es la IDENTIDAD del rol de
//    fábrica: no cambia nunca, sobrevive a un renombre y es lo ÚNICO por lo
//    que el código, las migraciones y las pruebas buscan un rol de fábrica.
//    Un rol personalizado la tiene en NULL. La base la cuida: CHECK con las
//    cuatro claves e índice único parcial (tenant_id, system_key), así que un
//    negocio tiene a lo sumo un rol de cada clave. Una clave nueva exige una
//    migración que amplíe el CHECK.
//  - El NOMBRE es lo que ve el equipo, en el idioma del dueño (el `locale`
//    del registro, mismo criterio que INITIAL_WAREHOUSE_NAME) y editable: el
//    negocio lo cambia como cualquier dato, y el front pinta lo que llega del
//    API (no hay i18n de roles). Por eso NADA decide por nombre.
//
// ⚠ UNA MIGRACIÓN DE PERMISOS FUTURA busca el rol por `r.system_key`, NUNCA
// por `r.name`:
//
//     INSERT INTO role_permissions (role_id, permission_id)
//     SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
//     WHERE r.system_key IN ('admin', 'manager') AND p.code IN (...)
//     ON CONFLICT (role_id, permission_id) DO NOTHING;
//
// Las 11 migraciones anteriores buscan por nombre ('Viewer', 'TenantAdmin'…)
// y NO se tocan: ya corrieron en todas las bases que existían, y en una base
// nueva no insertan nada porque todavía no hay roles. Por nombre, además, un
// rol que el negocio renombraba se quedaba sin los permisos siguientes.
//
// La autorización no depende de nada de esto: por la ley de f1-scope va por
// catálogo de permisos, nunca por nombre ni por clave de rol.
export const TENANT_ROLES = [
  { key: "admin", name: { es: "Administrador", en: "Admin" } },
  { key: "manager", name: { es: "Encargado", en: "Manager" } },
  { key: "seller", name: { es: "Cajero", en: "Cashier" } },
  { key: "viewer", name: { es: "Consulta", en: "Viewer" } },
] as const satisfies readonly { key: string; name: Record<"es" | "en", string> }[];

export type TenantRoleKey = (typeof TENANT_ROLES)[number]["key"];

/** Las claves de fábrica, en el orden en que nacen. */
export const TENANT_ROLE_KEYS: readonly TenantRoleKey[] = TENANT_ROLES.map((rol) => rol.key);

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

// 2026-08-26: almacenes y servicios también tienen campos dinámicos — cada
// catálogo del sistema es el ancla de los campos de SU entidad. La lista
// cerrada systemKey→tabla vive en catalogs/system-catalogs.ts.
export const WAREHOUSES_CATALOG_KEY = "warehouses";
export const WAREHOUSES_CATALOG_NAME = "Catálogo de Almacenes";
export const SERVICES_CATALOG_KEY = "services";
export const SERVICES_CATALOG_NAME = "Catálogo de Servicios";
/** F9-SUPPCAT-05 (Carlos, 2026-09-12): proveedores es un catálogo de primera clase, con campos propios. */
export const SUPPLIERS_CATALOG_KEY = "suppliers";
export const SUPPLIERS_CATALOG_NAME = "Catálogo de Proveedores";

/**
 * F3-HOME-03. El nombre del almacén con el que nace un tenant, por idioma del
 * owner. NEUTRO por LEY: sirve igual a una estética, un taller o un
 * consultorio, y un distribuidor lo renombra a "CEDIS" en un clic. A
 * diferencia del catálogo de productos, este nombre NO es de sistema — es una
 * sugerencia editable, no una referencia estable.
 */
export const INITIAL_WAREHOUSE_NAME: Record<"es" | "en", string> = {
  es: "Sucursal Principal",
  en: "Main Store",
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
// F9-CLINIC-05: `medical_clinic:attend` NO se excluye a propósito — el médico
// suele ser Manager. El consultorio que quiera privacidad estricta (la
// recepcionista sin acceso a expedientes) arma un rol personalizado «Médico».
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
 * devuelve qué codes le corresponden a cada rol de fábrica, por su CLAVE.
 * Función pura — testeable sin DB.
 */
export function resolveRolePermissionCodes(
  allCodes: readonly string[],
): Record<TenantRoleKey, string[]> {
  const readCodes = allCodes.filter(
    (code) => code.endsWith(":read") || VIEWER_EXTRA_CODES.has(code),
  );

  return {
    admin: [...allCodes],
    manager: allCodes.filter((code) => !MANAGER_EXCLUDED_CODES.has(code)),
    seller: allCodes.filter((code) => POS_SELLER_CODES.has(code)),
    viewer: readCodes,
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
