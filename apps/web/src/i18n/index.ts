import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "@sellpoint/shared";
import i18next, { type i18n as I18nInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enAuth from "./en/auth.json";
import enCommon from "./en/common.json";
import enOnboarding from "./en/onboarding.json";
import enUsers from "./en/users.json";
import enValidation from "./en/validation.json";
import esAuth from "./es/auth.json";
import esCommon from "./es/common.json";
import esOnboarding from "./es/onboarding.json";
import esUsers from "./es/users.json";
import esValidation from "./es/validation.json";

const resources = {
  es: {
    translation: {
      common: esCommon,
      auth: esAuth,
      validation: esValidation,
      users: esUsers,
      onboarding: esOnboarding,
    },
  },
  en: {
    translation: {
      common: enCommon,
      auth: enAuth,
      validation: enValidation,
      users: enUsers,
      onboarding: enOnboarding,
    },
  },
};

interface CreateI18nOptions {
  /**
   * Activa `i18next-browser-languagedetector` (localStorage → navigator).
   * OFF por default para instancias herméticas de test; la instancia real
   * de la app (singleton exportado más abajo) lo activa.
   */
  withDetector?: boolean;
}

/**
 * Factory pura: arma una instancia de i18next fresca. Se usa para el
 * singleton de la app y para instancias herméticas en tests (evita fuga de
 * estado de idioma / localStorage entre tests).
 */
export function createI18n(options: CreateI18nOptions = {}): I18nInstance {
  const { withDetector = false } = options;
  const instance = i18next.createInstance();
  let chain = instance.use(initReactI18next);

  if (withDetector) {
    chain = chain.use(LanguageDetector);
  }

  chain.init({
    resources,
    lng: withDetector ? undefined : DEFAULT_LOCALE,
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    load: "languageOnly",
    keySeparator: ".",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    detection: withDetector
      ? {
          order: ["localStorage", "navigator"],
          lookupLocalStorage: "sellpoint.locale",
          caches: ["localStorage"],
        }
      : undefined,
  });

  return instance;
}

/** Instancia real de la app: singleton a nivel de módulo, con detector activo. */
export const i18n = createI18n({ withDetector: true });
