import { getLocale, type Route } from "./markets";

/** El nombre de la marca. No se traduce, y por eso no vive en los textos. */
export const BRAND_NAME = "SellPointy";

/**
 * El correo de contacto público (2026-09-19). Existe de verdad: Cloudflare Email
 * Routing lo reenvía. El de privacidad, `privacy@`, vive en `SITIO-WEB-LEGAL.md`.
 */
export const CONTACT_EMAIL = "contact@sellpointy.com";

// A dónde llevan las dos puertas de la aplicación (SITIO-WEB-CONTENIDO.md §0 y §2).
const APP_ORIGIN = "https://app.sellpointy.com";

/** «Empieza gratis»: la acción principal del sitio. */
export const APP_REGISTER_URL = `${APP_ORIGIN}/register`;
/** «Iniciar sesión»: los clientes actuales teclean sellpointy.com por costumbre. */
export const APP_LOGIN_URL = `${APP_ORIGIN}/login`;

/**
 * La dirección de una puerta de la aplicación CON el idioma de quien la cruza
 * (Carlos, 2026-09-19).
 *
 * La aplicación arranca en INGLÉS mientras nadie haya elegido idioma en ese
 * navegador (decisión del 2026-08-16), así que sin esto alguien que leyó todo
 * el sitio en español aterrizaría en un registro en inglés. El `?lang=` lo
 * lee el detector de la aplicación, que además lo recuerda: pasar de
 * `/register` a `/login` ya no vuelve al inglés.
 *
 * El francés manda `en` a propósito: la aplicación todavía no lo habla
 * (`APP_MISSING_LANGUAGES`), y el sitio ya lo dice en la sección de planes.
 * Prometer francés en el enlace y entregar inglés adentro sería peor.
 */
export function appUrl(url: string, route: Route): string {
  const { language } = getLocale(route);
  return `${url}?lang=${language === "fr" ? "en" : language}`;
}

/** Las anclas de la página. En inglés, como todo identificador. */
export const ANCHORS = {
  main: "main",
  whatItDoes: "what-it-does",
  inAction: "in-action",
  benefits: "benefits",
  insights: "insights",
  plans: "plans",
  faq: "faq",
  contact: "contact",
} as const;
