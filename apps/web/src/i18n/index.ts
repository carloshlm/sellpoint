import { DEFAULT_LOCALE, type Locale, SUPPORTED_LOCALES } from "@sellpoint/shared";
import i18next, { type i18n as I18nInstance } from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import enAuth from "./en/auth.json";
import enCatalogs from "./en/catalogs.json";
import enCommon from "./en/common.json";
import enDashboard from "./en/dashboard.json";
import enInventory from "./en/inventory.json";
import enOnboarding from "./en/onboarding.json";
import enPos from "./en/pos.json";
import enProducts from "./en/products.json";
import enReports from "./en/reports.json";
import enServices from "./en/services.json";
import enUsers from "./en/users.json";
import enValidation from "./en/validation.json";
import enWarehouses from "./en/warehouses.json";
import esAuth from "./es/auth.json";
import esCatalogs from "./es/catalogs.json";
import esCommon from "./es/common.json";
import esDashboard from "./es/dashboard.json";
import esInventory from "./es/inventory.json";
import esOnboarding from "./es/onboarding.json";
import esPos from "./es/pos.json";
import esProducts from "./es/products.json";
import esReports from "./es/reports.json";
import esServices from "./es/services.json";
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
      dashboard: esDashboard,
      auth: esAuth,
      validation: esValidation,
      users: esUsers,
      onboarding: esOnboarding,
      catalogs: esCatalogs,
      warehouses: esWarehouses,
      inventory: esInventory,
      pos: esPos,
      products: esProducts,
      services: esServices,
      reports: esReports,
    },
  },
  en: {
    translation: {
      common: enCommon,
      dashboard: enDashboard,
      auth: enAuth,
      validation: enValidation,
      users: enUsers,
      onboarding: enOnboarding,
      catalogs: enCatalogs,
      warehouses: enWarehouses,
      inventory: enInventory,
      pos: enPos,
      products: enProducts,
      services: enServices,
      reports: enReports,
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

    /**
     * BARRERA: un `{{marcador}}` sin su argumento se pinta CRUDO en pantalla
     * — le pasó a Carlos con «No hay suficiente existencia de «{{sku}}»»,
     * donde los números interpolaban y el SKU no porque el API no lo
     * mandaba. En tests revienta para que el fallo salga en CI y no en el
     * celular de alguien; en producción se degrada a cadena vacía, que es
     * feo pero no rompe la pantalla.
     *
     * Sin heurísticas: no adivina qué argumentos "deberían" llegar, se entera
     * en el momento exacto en que i18next no encuentra uno.
     */
    missingInterpolationHandler: (texto: string, valor: unknown) => {
      if (import.meta.env.MODE === "test") {
        throw new Error(
          `Falta el argumento de interpolación ${String(valor)} en: "${texto}". ` +
            `Quien emite este mensaje tiene que mandarlo en \`args\`.`,
        );
      }
      return "";
    },

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
