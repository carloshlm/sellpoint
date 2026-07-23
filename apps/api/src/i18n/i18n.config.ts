import path from "node:path";
import { DEFAULT_LOCALE } from "@sellpoint/shared";
import { AcceptLanguageResolver, I18nJsonLoader, type I18nOptions } from "nestjs-i18n";

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
  resolvers: [AcceptLanguageResolver],
};
