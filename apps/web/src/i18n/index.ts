import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@sellpoint/shared";
import i18next, { type i18n as I18nInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enAuth from "./en/auth.json";
import enCatalogs from "./en/catalogs.json";
import enCommon from "./en/common.json";
import enInventory from "./en/inventory.json";
import enOnboarding from "./en/onboarding.json";
import enProducts from "./en/products.json";
import enUsers from "./en/users.json";
import enValidation from "./en/validation.json";
import enWarehouses from "./en/warehouses.json";
import esAuth from "./es/auth.json";
import esCatalogs from "./es/catalogs.json";
import esCommon from "./es/common.json";
import esInventory from "./es/inventory.json";
import esOnboarding from "./es/onboarding.json";
import esProducts from "./es/products.json";
import esUsers from "./es/users.json";
import esValidation from "./es/validation.json";
import esWarehouses from "./es/warehouses.json";

/**
 * Idioma de la PRIMERA visita, cuando todavía nadie eligió nada (decisión de
 * Carlos, 2026-08-16): las pantallas públicas arrancan en INGLÉS aunque la
 * mayoría de los clientes sean de México. Es una decisión de producto.
 *
 * Por eso el detector NO mira `navigator`: si lo mirara, un navegador en
 * español entregaría español y esta decisión sería letra muerta. Solo manda
 * lo que la persona eligió a mano en el selector (localStorage) y, si no
 * eligió nada, este valor.
 *
 * NO es `DEFAULT_LOCALE` (`es`, `@sellpoint/shared`), y la diferencia es a
 * propósito: ese sigue siendo el fallback del BACKEND (request sin
 * `Accept-Language`) y el de formato de moneda. Son dos decisiones distintas.
 *
 * El contrapeso vive en `lib/auth/ui-language.ts`: apenas hay sesión, el
 * idioma de la CUENTA pisa a este.
 */
export const INITIAL_LOCALE: Locale = "en";

const resources = {
  es: {
    translation: {
      common: esCommon,
      auth: esAuth,
      validation: esValidation,
      users: esUsers,
      onboarding: esOnboarding,
      catalogs: esCatalogs,
      warehouses: esWarehouses,
      inventory: esInventory,
      products: esProducts,
    },
  },
  en: {
    translation: {
      common: enCommon,
      auth: enAuth,
      validation: enValidation,
      users: enUsers,
      onboarding: enOnboarding,
      catalogs: enCatalogs,
      warehouses: enWarehouses,
      inventory: enInventory,
      products: enProducts,
    },
  },
};

interface CreateI18nOptions {
  /**
   * Activa `i18next-browser-languagedetector` (SOLO localStorage — ver
   * `INITIAL_LOCALE`). OFF por default para instancias herméticas de test,
   * que arrancan en `DEFAULT_LOCALE`; la instancia real de la app (singleton
   * exportado más abajo) lo activa y arranca en `INITIAL_LOCALE`.
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
    // Con detector, `fallbackLng` es lo que se usa cuando NO hay preferencia
    // guardada: ahí entra el inglés-first. Sin detector (tests), el idioma ya
    // viene fijado por `lng` y este valor solo cubre claves faltantes.
    fallbackLng: withDetector ? INITIAL_LOCALE : DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    load: "languageOnly",
    keySeparator: ".",
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    detection: withDetector
      ? {
          // `navigator` queda FUERA a propósito — ver `INITIAL_LOCALE`.
          order: ["localStorage"],
          lookupLocalStorage: "sellpoint.locale",
          caches: ["localStorage"],
        }
      : undefined,
  });

  return instance;
}

/** Instancia real de la app: singleton a nivel de módulo, con detector activo. */
export const i18n = createI18n({ withDetector: true });
