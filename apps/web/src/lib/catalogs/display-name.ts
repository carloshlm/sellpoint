/**
 * El nombre visible de un catálogo (Carlos, 2026-09-07).
 *
 * Carlos abrió «Catalog fields» con la sesión en inglés y el selector le
 * ofrecía «Catálogo de Almacenes», «Catálogo de Productos» y «Catálogo de
 * Servicios». No era una traducción faltante: esos nombres viven en la
 * columna `catalogs.name` de la base, sembrados en español por
 * `TenantsService.provision()` para todos los tenants del mundo.
 *
 * ── La ley ──────────────────────────────────────────────────────────────
 * El nombre de un catálogo del SISTEMA es COPY nuestro, no dato del negocio.
 * La prueba está en el servidor: intentar renombrarlo devuelve
 * `catalogs.system_cannot_be_renamed`. Un valor que el usuario no puede
 * cambiar y que sembramos nosotros es una etiqueta de la aplicación que
 * quedó guardada en una columna — y una etiqueta se muestra en el idioma de
 * quien la lee.
 *
 * El nombre de un SUBcatálogo, en cambio, lo escribió el usuario. Ese es dato
 * suyo y se muestra tal cual: traducir «Unidad de Medida» sería inventarle
 * palabras a alguien en su propio catálogo.
 *
 * La columna `name` NO se toca ni se migra: sigue siendo la referencia
 * estable que nombran los docs, el soporte y las dos migraciones de backfill.
 * Este cambio es de presentación y arregla de paso a todos los tenants que ya
 * existen, sin tocar una sola fila.
 */

/**
 * `systemKey` → clave de i18n, con las claves LITERALES para que un `rg` las
 * encuentre. Un `systemKey` fuera del mapa cae al nombre de la base: si nace
 * un cuarto catálogo del sistema y alguien olvida su clave, el usuario ve un
 * nombre legible en español y no `catalogs.system.labs` en la pantalla.
 */
const SYSTEM_CATALOG_NAME_KEYS: Readonly<Record<string, string>> = {
  products: "catalogs.system.products",
  warehouses: "catalogs.system.warehouses",
  services: "catalogs.system.services",
};

export function catalogDisplayName(
  catalog: { name: string; systemKey: string | null },
  t: (key: string) => string,
): string {
  if (catalog.systemKey === null) {
    return catalog.name;
  }
  const key = SYSTEM_CATALOG_NAME_KEYS[catalog.systemKey];
  return key === undefined ? catalog.name : t(key);
}
