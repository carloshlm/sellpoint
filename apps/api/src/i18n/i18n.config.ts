import path from "node:path";
import { DEFAULT_LOCALE } from "@sellpoint/shared";
import { AcceptLanguageResolver, I18nJsonLoader, type I18nOptions } from "nestjs-i18n";
import { RequestLocaleResolver } from "./request-locale.resolver";

/**
 * Config compartida de nestjs-i18n para AppModule y para el harness e2e slim
 * (ver test/i18n.e2e-spec.ts).
 *
 * `__dirname` resuelve a `src/i18n` en dev (ts-node) y test (ts-jest), y a
 * `dist/i18n` en producción (tsc), porque este archivo vive dentro de la
 * carpeta `i18n` en ambos casos.
 */
export const i18nOptions: I18nOptions = {
  fallbackLanguage: DEFAULT_LOCALE,
  fallbacks: {
    "es-*": "es",
    "en-*": "en",
  },
  loaderOptions: {
    path: path.join(__dirname),
    watch: process.env.NODE_ENV !== "production",
  },
  loader: I18nJsonLoader,
  // F1-LOCALE-03: RequestLocaleResolver primero (cascada user.locale ->
  // Accept-Language -> default, ver request-locale.ts); AcceptLanguageResolver
  // queda como red de seguridad (nestjs-i18n prueba resolvers en orden hasta
  // que uno devuelve algo distinto de undefined — RequestLocaleResolver NUNCA
  // devuelve undefined, así que en la práctica el segundo resolver es
  // inalcanzable hoy, pero se deja explícito por si alguna vez se relaja el
  // contrato de RequestLocaleResolver). Sin deps de constructor (ver el
  // comentario en request-locale.resolver.ts) — seguro también en el módulo
  // slim de test/i18n.e2e-spec.ts.
  resolvers: [RequestLocaleResolver, AcceptLanguageResolver],
};
