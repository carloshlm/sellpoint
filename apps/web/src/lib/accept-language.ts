import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@sellpoint/shared";
import type { AxiosInstance } from "axios";

/**
 * W2 del verify de f1-web-auth: el front NUNCA mandaba `Accept-Language`, así
 * que los mensajes del backend salían en el idioma del NAVEGADOR y no en el
 * de la app. El backend traduce bien —el mismo `code` devuelve texto distinto
 * según el header, verificado contra producción—; lo que faltaba era decirle
 * en qué idioma.
 *
 * Alcance del arreglo: TODA pantalla no autenticada (login, register,
 * forgot/reset password, accept-invitation, verify-email y el 429 del
 * throttle). Ahí no hay Bearer, así que el header es lo ÚNICO que el backend
 * puede mirar (`i18n/request-locale.ts`: claim del JWT -> Accept-Language ->
 * DEFAULT_LOCALE).
 *
 * RESIDUAL CONOCIDO en requests AUTENTICADAS: el claim `locale` del JWT tiene
 * prioridad sobre el header, y `PATCH /me` no reemite el access token. Tras
 * cambiar el idioma en `/profile`, los errores autenticados siguen llegando
 * en el idioma anterior hasta el próximo refresh (<=15 min) o un re-login.
 * Cerrarlo requiere tocar el backend (reemitir el token en `PATCH /me`) y
 * queda fuera de este arreglo.
 */

/** Lo mínimo que se le pide a i18next: qué idioma está viendo el usuario. */
export interface UiLanguageSource {
  language: string;
  resolvedLanguage?: string;
}

/**
 * `resolvedLanguage` es el idioma cuyos recursos se están renderizando de
 * verdad —o sea, LO QUE EL USUARIO LEE—, ya normalizado por `supportedLngs` y
 * `load: "languageOnly"`. `language` puede traer región (`es-MX`) o un idioma
 * que ni siquiera está soportado; sirve solo de respaldo mientras i18next
 * inicializa. El backend tolera la región (parte el tag por `-`), pero se
 * manda el resuelto por ser el que refleja la pantalla.
 */
export function resolveUiLanguage(source: UiLanguageSource): string {
  return source.resolvedLanguage ?? source.language;
}

/**
 * Igual que `resolveUiLanguage`, pero acotado al tipo `Locale` para los helpers
 * de `@sellpoint/shared` que eligen texto por idioma (por ejemplo `unitName`).
 *
 * Un idioma fuera de los soportados cae al default en vez de propagarse: llega
 * hasta acá solo si i18next todavía no resolvió, y en ese instante mostrar el
 * idioma por omisión es mejor que romper el tipo.
 */
export function resolveUiLocale(source: UiLanguageSource): Locale {
  const language = resolveUiLanguage(source);
  return (SUPPORTED_LOCALES as readonly string[]).includes(language)
    ? (language as Locale)
    : DEFAULT_LOCALE;
}

/**
 * Se resuelve POR REQUEST, no al instalar: si se clavara en los `headers` por
 * defecto de la instancia, el header quedaría congelado en el idioma que
 * había al arrancar la app y el selector de `/profile` no lo movería.
 */
export function installAcceptLanguageInterceptor(
  api: AxiosInstance,
  source: UiLanguageSource,
): void {
  api.interceptors.request.use((config) => {
    config.headers.set("Accept-Language", resolveUiLanguage(source));
    return config;
  });
}
