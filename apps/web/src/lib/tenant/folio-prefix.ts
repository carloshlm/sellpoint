import { type FolioSeries, folioPrefix } from "@sellpoint/shared";
import { useAuthStore } from "@/stores/auth.store";

/**
 * El prefijo de folio de una serie en el juego del NEGOCIO (`VTA` o `SLS`,
 * `TUR` o `SHF`…), no en el idioma de quien usa la pantalla (Carlos,
 * 2026-11-16: «el folío no lo define el idioma del usuario sino el idioma
 * principal de un país»). Lo usan los ejemplos de folio de los buscadores.
 */
export function useFolioPrefix(series: FolioSeries): string {
  const language = useAuthStore((s) => s.user?.tenant.folioLanguage);
  return folioPrefix(language, series);
}
