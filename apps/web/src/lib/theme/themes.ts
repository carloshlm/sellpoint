/**
 * Catálogo de TEMAS del negocio (Carlos, 2026-08-25/26).
 *
 * El tenant elige UN tema y toda la app se pinta con él. Ocho temas en dos
 * tandas, todos elegidos por Carlos de los artefactos "Temas de SellPoint":
 * la primera (Claro, Grafito, Crema, Bitono) se ofrece en el WIZARD; las dos
 * completas viven en Mi perfil — el paso 3 lo avisa.
 *
 * PARA AGREGAR UN TEMA NUEVO (3 pasos, en este orden):
 *   1. `index.css`: bloque `:root[data-theme="<id>"]` con TODOS los tokens.
 *   2. Este archivo: una entrada en `THEMES` (con `isDark` si aplica).
 *   3. `apps/api`: el id en el enum de `theme` (update-tenant.dto.ts).
 * El test `themes.test.ts` falla si (1) y (2) se desincronizan.
 *
 * `swatch` NO pinta la app (eso lo hace el CSS): es la muestra que el
 * selector le enseña al usuario para que reconozca cada tema de un vistazo.
 * `isDark` enciende la clase `.dark` junto al atributo: los semánticos
 * oscuros y las variantes `dark:` de los componentes cuelgan de ella.
 */

export const THEME_IDS = [
  "light",
  "dark",
  "sand",
  "grape",
  "emerald",
  "cabin",
  "cotton",
  "charcoal",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/** El tema antes de saber a qué tenant pertenece quien mira (login, registro). */
export const DEFAULT_THEME: ThemeId = "light";

/**
 * Los que ofrece el paso 3 del wizard (Carlos, 2026-08-26): la primera tanda
 * nada más — elegir tema no debe volverse la parte larga del registro. El
 * copy del paso avisa que en Mi perfil hay más.
 */
export const WIZARD_THEME_IDS: readonly ThemeId[] = ["light", "dark", "sand", "grape"];

export interface ThemeOption {
  id: ThemeId;
  /** Clave i18n del nombre visible. Nunca texto hardcodeado (convención del proyecto). */
  nameKey: string;
  /** La muestra del selector. Los hex están permitidos ACÁ: es el catálogo. */
  swatch: string;
  /** Enciende `.dark` al aplicarse (semánticos oscuros + variantes de componentes). */
  isDark: boolean;
}

export const THEMES: Readonly<Record<ThemeId, ThemeOption>> = {
  light: { id: "light", nameKey: "common.theme.names.light", swatch: "#ffffff", isDark: false },
  dark: { id: "dark", nameKey: "common.theme.names.dark", swatch: "#1b1d21", isDark: true },
  sand: { id: "sand", nameKey: "common.theme.names.sand", swatch: "#b57f55", isDark: false },
  grape: { id: "grape", nameKey: "common.theme.names.grape", swatch: "#5d5468", isDark: false },
  emerald: {
    id: "emerald",
    nameKey: "common.theme.names.emerald",
    swatch: "#2e7d5b",
    isDark: false,
  },
  cabin: { id: "cabin", nameKey: "common.theme.names.cabin", swatch: "#d92d3f", isDark: true },
  cotton: { id: "cotton", nameKey: "common.theme.names.cotton", swatch: "#e37e9e", isDark: false },
  charcoal: {
    id: "charcoal",
    nameKey: "common.theme.names.charcoal",
    swatch: "#d9954a",
    isDark: true,
  },
};

export const THEME_LIST: readonly ThemeOption[] = THEME_IDS.map((id) => THEMES[id]);

export const WIZARD_THEME_LIST: readonly ThemeOption[] = WIZARD_THEME_IDS.map((id) => THEMES[id]);

/** Un valor guardado inválido (tema borrado, dato viejo) cae al default. */
export function resolveTheme(value: unknown): ThemeId {
  return THEME_IDS.includes(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME;
}
