import type { Locale } from "./i18n";

/**
 * F11-SITE-LEGAL — los términos y el aviso de privacidad de SellPointy.
 *
 * ── EL INTERRUPTOR ──────────────────────────────────────────────────────
 * Esta constante es el ÚNICO interruptor de todo lo legal: la casilla del
 * registro, el diálogo de quien ya tiene cuenta y la exigencia del API.
 *
 * Mientras valga `null`, la aplicación se comporta EXACTAMENTE como antes de
 * F11-SITE-LEGAL: el registro no pinta casilla ni exige nada, nadie ve un
 * diálogo al entrar y el API acepta un alta sin `acceptTerms`. Está dormido a
 * propósito: los textos de `SITIO-WEB-LEGAL.md` todavía tienen `[[huecos]]`
 * y una razón social provisional, y un aviso de privacidad sin responsable
 * identificado no es un aviso. Publicar la casilla antes que el texto sería
 * pedirle a la gente que acepte una página que no existe.
 *
 * El día que los textos se publiquen, ENCENDER es cambiar esta línea por la
 * fecha de publicación (`"2026-10-01"`, por ejemplo) y desplegar: no hay otra
 * palanca, ni una variable de entorno, ni una fila en la base. Y como es una
 * VERSIÓN y no un booleano, el día que el texto cambie de verdad basta con
 * poner la fecha nueva para que todo el mundo lo vuelva a aceptar.
 */
export const CURRENT_TERMS_VERSION: string | null = null;

/**
 * Los textos viven en el sitio público (`apps/site`), no en la aplicación: son
 * los mismos que lee alguien que todavía no tiene cuenta, y duplicarlos sería
 * garantizar que un día digan cosas distintas.
 *
 * Una URL por idioma de la APLICACIÓN (`es`, `en`). El francés del sitio no
 * está acá porque `SUPPORTED_LOCALES` no lo incluye — el día que entre, estas
 * dos tablas crecen solas por el tipo.
 */
export const TERMS_URL: Record<Locale, string> = {
  es: "https://sellpointy.com/es-mx/terminos/",
  en: "https://sellpointy.com/en-us/terms/",
};

export const PRIVACY_URL: Record<Locale, string> = {
  es: "https://sellpointy.com/es-mx/privacidad/",
  en: "https://sellpointy.com/en-us/privacy/",
};

/**
 * ¿Hay algo vigente que aceptar? Es la pregunta del REGISTRO, donde todavía
 * no existe un usuario contra el cual comparar nada.
 *
 * La versión llega por parámetro y no se lee de la constante: así el API la
 * inyecta (y los tests la fabrican) sin tocar un módulo global.
 */
export function termsAcceptanceRequired(currentVersion: string | null): boolean {
  return currentVersion !== null;
}

/**
 * ¿Este usuario tiene que aceptar? Es la pregunta de la SESIÓN.
 *
 * Verdadero cuando hay una versión vigente y la que el usuario aceptó es otra
 * — o ninguna. Comparación por igualdad y no por orden: una versión es una
 * etiqueta, no un número, y «distinta» es exactamente el criterio que hace
 * que corregir el texto vuelva a pedir la aceptación.
 */
export function mustAcceptTerms(
  userTermsVersion: string | null | undefined,
  currentVersion: string | null = CURRENT_TERMS_VERSION,
): boolean {
  if (currentVersion === null) {
    return false;
  }
  return (userTermsVersion ?? null) !== currentVersion;
}
