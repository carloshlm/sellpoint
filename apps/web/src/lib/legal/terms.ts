import type { Locale } from "@sellpoint/shared";
import { CURRENT_TERMS_VERSION, PRIVACY_URL, TERMS_URL } from "@sellpoint/shared";

/**
 * F11-SITE-LEGAL-02/03 — el interruptor legal, visto desde el front.
 *
 * ── Por qué una FUNCIÓN y no la constante importada a pelo ──────────────
 * Todo lo legal del web pregunta por acá, y no le importa a
 * `@sellpoint/shared`. Dos razones, y ninguna es de estilo:
 *
 *  1. las pruebas encienden y apagan los términos mockeando ESTE módulo —
 *     tres exportaciones— en vez de `@sellpoint/shared` entero, que tiene
 *     cientos y cuyo mock parcial es una fuente de sorpresas;
 *  2. si mañana la versión llegara del API en vez de una constante, cambia
 *     este archivo y nada más.
 *
 * Hoy devuelve `null`: los textos no están publicados, así que el registro no
 * pinta casilla y nadie ve el diálogo.
 */
export function currentTermsVersion(): string | null {
  return CURRENT_TERMS_VERSION;
}

/** ¿Hay algo vigente que aceptar? */
export function termsEnabled(): boolean {
  return currentTermsVersion() !== null;
}

/**
 * Los dos enlaces, en el idioma de la interfaz. Apuntan al SITIO público
 * (`sellpointy.com`), que es donde viven los textos: son los mismos que lee
 * quien todavía no tiene cuenta, y tener dos copias sería garantizar que un
 * día digan cosas distintas.
 */
export function legalLinks(locale: Locale): { terms: string; privacy: string } {
  return { terms: TERMS_URL[locale], privacy: PRIVACY_URL[locale] };
}

/** El idioma de la interfaz normalizado a los dos que la aplicación habla. */
export function localeFromI18n(language: string): Locale {
  return language.startsWith("en") ? "en" : "es";
}
