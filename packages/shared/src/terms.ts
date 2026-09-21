import type { Locale } from "./i18n";

/**
 * F11-SITE-LEGAL — los términos y el aviso de privacidad de SellPointy.
 *
 * ── EL INTERRUPTOR ──────────────────────────────────────────────────────
 * Esta constante es el ÚNICO interruptor de todo lo legal: las dos casillas
 * del registro, el diálogo de quien ya tiene cuenta y la exigencia del API.
 *
 * **ENCENDIDO el 2026-09-19** (Carlos): ese día `SITIO-WEB-LEGAL.md` se
 * publicó sin huecos —responsable identificado, domicilio, correos del
 * dominio— y los dos textos quedaron en línea en sellpointy.com. Desde
 * entonces nadie crea una cuenta sin aceptar los Términos y condiciones y
 * reconocer el Aviso de privacidad, y quien ya tenía cuenta los acepta la
 * próxima vez que entra (la pared de `TermsGate`).
 *
 * Con `null` todo vuelve a DORMIR: el registro no pinta casillas ni exige
 * nada, nadie ve un diálogo y el API acepta un alta sin `acceptTerms` ni
 * `acceptPrivacy`. Nació así a propósito: publicar las casillas antes que el
 * texto sería pedirle a la gente que acepte una página que no existe.
 *
 * No hay otra palanca en producción: ni una variable de entorno, ni una fila
 * en la base. Y como es una VERSIÓN y no un booleano, **el día que el texto
 * cambie de verdad basta con poner la fecha nueva** para que todo el mundo lo
 * vuelva a aceptar. Un cambio de redacción que no altera derechos ni
 * obligaciones NO pide fecha nueva: cada cambio de fecha le pone la pared a
 * todos los usuarios.
 *
 * **2026-09-21 — segunda versión.** Cambian derechos y obligaciones: el cliente
 * responde por la información que captura (T5), se reparte con detalle quién
 * hace qué como responsable y como encargado (T7), entra la indemnización
 * (T14) y nace el Anexo A del módulo de Consultorio médico (A1–A11), que la T8
 * anterior daba por hecho y no existía. Por eso la fecha nueva: todos vuelven a
 * aceptar.
 */
export const CURRENT_TERMS_VERSION: string | null = "2026-09-21";

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
