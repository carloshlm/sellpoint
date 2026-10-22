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
 * F10-THEME-05 — un tema `skinned` además VISTE cada tipo de elemento
 * (menú, tarjetas, botones, campos, tablas, badges…): `applyTheme` enciende
 * la clase `.skinned` y las reglas de la piel en `index.css` leen los tokens
 * `--skin-*` del bloque del tema. Sin piel, un tema solo cambia colores.
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
  "espresso",
  "grape",
  "emerald",
  "jade",
  "forest",
  "cabin",
  "cotton",
  "charcoal",
  "sellpointy",
  "liquid",
  "cobalt",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

/**
 * El tema antes de saber a qué tenant pertenece quien mira (inicio de sesión,
 * registro), el preseleccionado del wizard y el de un negocio sin tema
 * guardado. Desde el 2026-09-26 es el de la marca (Carlos). Los negocios que
 * ya existían sin tema quedaron fijados en `light` por migración, para no
 * cambiarles el aspecto sin avisar, y los nuevos nacen con `sellpointy` en la
 * base: mover este default ya no repinta a nadie.
 */
export const DEFAULT_THEME: ThemeId = "sellpointy";

/**
 * El tema cuyos tokens viven en `:root` (sin `data-theme`). No es lo mismo
 * que el default: `:root` es la red de seguridad, la paleta clara completa
 * que se ve si falta un bloque, y por eso se queda en Claro.
 */
export const ROOT_THEME: ThemeId = "light";

/**
 * Los que ofrece el paso 3 del wizard (Carlos, 2026-08-26): la primera tanda
 * nada más — elegir tema no debe volverse la parte larga del registro. El
 * copy del paso avisa que en Mi perfil hay más. El ORDEN es el de pantalla:
 * desde el 2026-09-26 abre con el de la marca y Algodón toma el lugar de Uva
 * (Carlos). Mi perfil no usa esta lista: muestra el catálogo en su orden.
 */
export const WIZARD_THEME_IDS: readonly ThemeId[] = [
  "sellpointy",
  "light",
  "dark",
  "sand",
  "cotton",
];

export interface ThemeOption {
  id: ThemeId;
  /** Clave i18n del nombre visible. Nunca texto hardcodeado (convención del proyecto). */
  nameKey: string;
  /** La muestra del selector. Los hex están permitidos ACÁ: es el catálogo. */
  swatch: string;
  /** Enciende `.dark` al aplicarse (semánticos oscuros + variantes de componentes). */
  isDark: boolean;
  /** F10-THEME-05: enciende `.skinned`, la piel por componente (forma, letra, superficies). */
  skinned?: boolean;
}

export const THEMES: Readonly<Record<ThemeId, ThemeOption>> = {
  light: { id: "light", nameKey: "common.theme.names.light", swatch: "#ffffff", isDark: false },
  dark: { id: "dark", nameKey: "common.theme.names.dark", swatch: "#1b1d21", isDark: true },
  // Arena, Algodón, Cabina y SellPointy se REEMPLAZARON por su versión con piel
  // el 2026-10-22 (Carlos): mismo id y mismo nombre, así que los negocios que
  // ya los tenían ven el tema nuevo sin migrar nada.
  sand: {
    id: "sand",
    nameKey: "common.theme.names.sand",
    swatch: "#9a6340",
    isDark: false,
    skinned: true,
  },
  // Bitono: el menú en espresso, el contenido en crema.
  espresso: {
    id: "espresso",
    nameKey: "common.theme.names.espresso",
    swatch: "#2a2019",
    isDark: false,
    skinned: true,
  },
  grape: { id: "grape", nameKey: "common.theme.names.grape", swatch: "#5d5468", isDark: false },
  emerald: {
    id: "emerald",
    nameKey: "common.theme.names.emerald",
    swatch: "#2e7d5b",
    isDark: false,
  },
  // Su verde es el mismo de Esmeralda: la muestra toma el jade más claro de
  // su degradado para que las dos no se vean iguales en el selector.
  jade: {
    id: "jade",
    nameKey: "common.theme.names.jade",
    swatch: "#4fa37c",
    isDark: false,
    skinned: true,
  },
  // Bitono: el menú en verde bosque, el contenido claro.
  forest: {
    id: "forest",
    nameKey: "common.theme.names.forest",
    swatch: "#12291f",
    isDark: false,
    skinned: true,
  },
  cabin: {
    id: "cabin",
    nameKey: "common.theme.names.cabin",
    swatch: "#d92d3f",
    isDark: true,
    skinned: true,
  },
  cotton: {
    id: "cotton",
    nameKey: "common.theme.names.cotton",
    swatch: "#e37e9e",
    isDark: false,
    skinned: true,
  },
  charcoal: {
    id: "charcoal",
    nameKey: "common.theme.names.charcoal",
    swatch: "#d9954a",
    isDark: true,
  },
  // La marca (Carlos, 2026-09-26; en oscuro desde el 2026-10-22, «Punto
  // Azul»): la muestra es el azul del menú, lo que la distingue de un vistazo.
  sellpointy: {
    id: "sellpointy",
    nameKey: "common.theme.names.sellpointy",
    swatch: "#1e3fd8",
    isDark: true,
    skinned: true,
  },
  // F10-THEME-05 (Carlos, 2026-10-22): grafito neutro, vidrio ahumado y luz
  // celeste. El primero con piel. La muestra es su celeste, como la de los
  // otros oscuros es su acento: el grafito solo se confundiría con Oscuro.
  liquid: {
    id: "liquid",
    nameKey: "common.theme.names.liquid",
    swatch: "#7fd4f6",
    isDark: true,
    skinned: true,
  },
  // F10-THEME-05 (Carlos, 2026-10-22): el claro con piel, niebla fría y
  // cobalto. La muestra es su cobalto, que no se confunde con el azul profundo
  // de SellPointy.
  cobalt: {
    id: "cobalt",
    nameKey: "common.theme.names.cobalt",
    swatch: "#2846e8",
    isDark: false,
    skinned: true,
  },
};

export const THEME_LIST: readonly ThemeOption[] = THEME_IDS.map((id) => THEMES[id]);

export const WIZARD_THEME_LIST: readonly ThemeOption[] = WIZARD_THEME_IDS.map((id) => THEMES[id]);

/** Un valor guardado inválido (tema borrado, dato viejo) cae al default. */
export function resolveTheme(value: unknown): ThemeId {
  return THEME_IDS.includes(value as ThemeId) ? (value as ThemeId) : DEFAULT_THEME;
}
