import { ROOT_THEME, resolveTheme, THEMES, type ThemeId } from "./themes";

/**
 * Aplica un tema al documento — la ÚNICA forma de cambiar el tema activo.
 *
 * Dos escrituras, y las dos importan:
 * - `data-theme` en <html> activa el bloque de tokens del tema en
 *   `index.css`. Claro (`ROOT_THEME`) LIMPIA el atributo: `:root` ya trae la
 *   paleta clara completa y así la app nunca aparece sin estilos. El default
 *   (SellPointy, sin argumento o con un valor inválido) sí lo escribe.
 * - La clase `.dark` acompaña a los temas que el catálogo marca `isDark`
 *   (Grafito, Cabina, Carbón): los tokens los trae su bloque, pero los
 *   semánticos oscuros (success/warning) y las variantes `dark:` de los
 *   componentes shadcn cuelgan de la clase.
 * - La clase `.skinned` acompaña a los temas con piel (F10-THEME-05): las
 *   reglas que visten cada tipo de elemento cuelgan de ella.
 */
export function applyTheme(theme?: string | null): ThemeId {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  if (resolved === ROOT_THEME) {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = resolved;
  }
  root.classList.toggle("dark", THEMES[resolved].isDark);
  // F10-THEME-05: la piel por componente, solo en los temas que la traen.
  root.classList.toggle("skinned", THEMES[resolved].skinned === true);
  return resolved;
}
