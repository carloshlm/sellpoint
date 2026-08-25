/**
 * Catálogo de TEMAS del negocio (Carlos, 2026-08-25).
 *
 * Reemplaza al sistema anterior de dos ejes (marca × modo): el tenant elige
 * UN tema y toda la app se pinta con él. Los cuatro nacen de las propuestas
 * que Carlos eligió del artefacto "Temas de SellPoint": Claro (el aspecto
 * original), Oscuro «Grafito», Uva «Bitono» y Arena «Crema».
 *
 * PARA AGREGAR UN TEMA NUEVO (3 pasos, en este orden):
 *   1. `index.css`: bloque `:root[data-theme="<id>"]` con TODOS los tokens.
 *   2. Este archivo: una entrada en `THEMES`.
 *   3. `apps/api`: el id en el enum de `theme` (update-tenant.dto.ts).
 * El test `themes.test.ts` falla si (1) y (2) se desincronizan.
 *
 * `swatch` NO pinta la app (eso lo hace el CSS): es la muestra que el
 * selector le enseña al usuario para que reconozca cada tema de un vistazo.
 */

export const THEME_IDS = ["light", "dark", "sand", "grape"] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/** El tema antes de saber a qué tenant pertenece quien mira (login, registro). */
export const DEFAULT_THEME: ThemeId = "light";

export interface ThemeOption {
  id: ThemeId;
  /** Clave i18n del nombre visible. Nunca texto hardcodeado (convención del proyecto). */
  nameKey: string;
  /** La muestra del selector. Los hex están permitidos ACÁ: es el catálogo. */
  swatch: string;
}

export const THEMES: Readonly<Record<ThemeId, ThemeOption>> = {
  light: { id: "light", nameKey: "common.theme.names.light", swatch: "#ffffff" },
  dark: { id: "dark", nameKey: "common.theme.names.dark", swatch: "#1b1d21" },
  sand: { id: "sand", nameKey: "common.theme.names.sand", swatch: "#b57f55" },
  grape: { id: "grape", nameKey: "common.theme.names.grape", swatch: "#5d5468" },
};

export const THEME_LIST: readonly ThemeOption[] = THEME_IDS.map((id) => THEMES[id]);

/** Un valor guardado inválido (tema borrado, dato viejo) cae al default. */
export function resolveTheme(value: unknown): ThemeId {
  return THEME_IDS.includes(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME;
}
