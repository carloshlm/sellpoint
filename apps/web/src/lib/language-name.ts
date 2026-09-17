/**
 * «fr» → «francés» / «French», en el idioma de quien lee.
 *
 * `Intl.DisplayNames` lo trae el navegador: mantener a mano una lista de
 * idiomas traducida sería copiar algo que la plataforma ya sabe, y el volcado
 * del catálogo global tiene decenas. Si el navegador no lo conoce, se muestra
 * el código tal cual antes que una etiqueta vacía.
 */
export function languageName(codigo: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "language" }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}
