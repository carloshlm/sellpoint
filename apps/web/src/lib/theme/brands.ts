/**
 * Catálogo de MARCAS de la plataforma (eje 1 del sistema de temas).
 *
 * Cada tenant elige una marca en su configuración y toda la app se pinta con
 * ella. El eje 2 (claro/oscuro) lo elige cada usuario y es independiente:
 * cualquier marca funciona en ambos modos.
 *
 * PARA AGREGAR UNA MARCA NUEVA (3 pasos, en este orden):
 *   1. `index.css`: bloque `[data-brand="<id>"]` (claro) y
 *      `[data-brand="<id>"].dark` (oscuro) con TODOS los tokens.
 *   2. Este archivo: una entrada en `BRANDS`.
 *   3. `apps/api`: agregar el id al enum/CHECK de la columna `tenants.theme`
 *      cuando exista (ver bitácora F1-WEB-AUTH) — hasta entonces, el backend
 *      no valida marcas y el default vive solo acá.
 * El test `brands.test.ts` falla si (1) y (2) se desincronizan.
 *
 * `swatch` NO pinta la app (eso lo hace el CSS): son las muestras que el
 * selector le enseña al cliente para que reconozca cada tema de un vistazo.
 */

export const BRAND_IDS = ["cobalto", "menta", "teal"] as const;

export type BrandId = (typeof BRAND_IDS)[number];

/** Marca que se usa antes de saber a qué tenant pertenece el usuario. */
export const DEFAULT_BRAND: BrandId = "cobalto";

export interface Brand {
  id: BrandId;
  /** Clave i18n del nombre visible. Nunca texto hardcodeado (convención del proyecto). */
  nameKey: string;
  /** Clave i18n de la descripción corta que acompaña al nombre en el selector. */
  descriptionKey: string;
  /** Muestras para la vista previa del selector: [primario, superficie, texto]. */
  swatch: readonly [string, string, string];
}

export const BRANDS: Readonly<Record<BrandId, Brand>> = {
  cobalto: {
    id: "cobalto",
    nameKey: "theme.brands.cobalto.name",
    descriptionKey: "theme.brands.cobalto.description",
    swatch: ["#2456e5", "#f4f6fb", "#1a2233"],
  },
  menta: {
    id: "menta",
    nameKey: "theme.brands.menta.name",
    descriptionKey: "theme.brands.menta.description",
    swatch: ["#0e9f6e", "#f2f6f2", "#1b2a24"],
  },
  teal: {
    id: "teal",
    nameKey: "theme.brands.teal.name",
    descriptionKey: "theme.brands.teal.description",
    swatch: ["#0d8f88", "#f0f5f6", "#16252b"],
  },
} as const;

/** Lista ordenada para renderizar el selector sin depender del orden de claves. */
export const BRAND_LIST: readonly Brand[] = BRAND_IDS.map((id) => BRANDS[id]);

/**
 * Valida un valor desconocido (config del tenant, localStorage, querystring)
 * y cae al default si no es una marca real. Fail-safe: una marca inválida
 * pinta la app con el default, nunca la deja sin tokens.
 */
export function resolveBrand(value: unknown): BrandId {
  return BRAND_IDS.includes(value as BrandId) ? (value as BrandId) : DEFAULT_BRAND;
}
