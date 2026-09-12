import {
  PRODUCTS_CATALOG_KEY,
  SERVICES_CATALOG_KEY,
  SUPPLIERS_CATALOG_KEY,
  WAREHOUSES_CATALOG_KEY,
} from "../tenants/role-catalog";

/**
 * El registry de catálogos del sistema (2026-08-26): a qué tabla de primera
 * clase pertenece el JSONB de cada uno. Es la fuente ÚNICA que reemplaza a la
 * vieja bifurcación `isSystem ? products : catalog_records` — con tres
 * catálogos de sistema esa rama contaba en la tabla equivocada.
 *
 * LISTA CERRADA a propósito: estos nombres de tabla se interpolan en SQL
 * crudo (`Prisma.raw`), así que solo pueden salir de acá — jamás del
 * `systemKey` que venga de la base.
 */
export type SystemAttributeTable = "products" | "warehouses" | "services" | "suppliers";

export const SYSTEM_ATTRIBUTE_TABLES: Readonly<Record<string, SystemAttributeTable>> = {
  [PRODUCTS_CATALOG_KEY]: "products",
  [WAREHOUSES_CATALOG_KEY]: "warehouses",
  [SERVICES_CATALOG_KEY]: "services",
  // F9-SUPPCAT-05: la cuarta tabla de primera clase con JSONB propio.
  [SUPPLIERS_CATALOG_KEY]: "suppliers",
};

/** La tabla del catálogo de sistema, o null para un subcatálogo. */
export function systemAttributeTable(systemKey: string | null): SystemAttributeTable | null {
  return systemKey === null ? null : (SYSTEM_ATTRIBUTE_TABLES[systemKey] ?? null);
}
