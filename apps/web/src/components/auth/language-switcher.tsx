import { type Locale, SUPPORTED_LOCALES } from "@sellpoint/shared";
import { useTranslation } from "react-i18next";
import { useUpdateLocale } from "@/lib/auth/hooks";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

/**
 * Cada idioma se nombra EN SÍ MISMO, nunca traducido ("Inglés" / "Spanish").
 * Es la convención de cualquier selector de idioma y tiene una razón dura:
 * quien cae en una pantalla que no entiende necesita reconocer su idioma
 * escrito como él lo escribe. Por eso no son claves i18n — el mismo texto en
 * los dos idiomas —, sino un catálogo de endónimos.
 *
 * Tipado como `Record<Locale, string>`: agregar un idioma a
 * `SUPPORTED_LOCALES` sin su endónimo rompe el build, no la pantalla.
 */
const LANGUAGE_ENDONYMS: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

/**
 * Selector de idioma de las pantallas PÚBLICAS (decisión de Carlos,
 * 2026-08-16). Vive en `AuthCard`, así que lo heredan login, register,
 * forgot/reset password, verify-email y accept-invitation.
 *
 * Es un control segmentado y no un `<select>` a propósito: con dos idiomas,
 * dos botones visibles cambian con un clic y NO se confunden con un campo
 * más del formulario. El hermano autenticado es
 * `components/profile/language-preference.tsx`, que además persiste la
 * elección en la cuenta vía `PATCH /me`; acá no hay sesión todavía, así que
 * la única persistencia es el cache en localStorage del detector de i18next
 * — y `register.tsx`, que manda el idioma vigente como `locale` de la cuenta
 * nueva.
 */
interface LanguageSwitcherProps {
  /** Sin él, solo cambia el idioma de la pantalla (las pantallas públicas). */
  onSelect?: (locale: Locale) => void;
}

function LanguageSwitcher({ onSelect }: LanguageSwitcherProps) {
  const { t, i18n } = useTranslation();
  const current = i18n.resolvedLanguage ?? i18n.language;

  return (
    // `<fieldset>` y no un `<div role="group">`: es el elemento nativo para
    // agrupar controles y trae el rol `group` de fábrica (lint de Biome
    // `a11y/useSemanticElements`). Sin `<legend>` porque el nombre accesible
    // lo da el `aria-label` y una leyenda visible sobraría en este tamaño.
    <fieldset
      aria-label={t("common.languageSwitcher.label")}
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5"
    >
      {SUPPORTED_LOCALES.map((locale) => {
        const isActive = locale === current;
        return (
          <button
            key={locale}
            type="button"
            lang={locale}
            aria-pressed={isActive}
            onClick={() => {
              if (isActive) {
                return;
              }
              if (onSelect) {
                onSelect(locale);
              } else {
                void i18n.changeLanguage(locale);
              }
            }}
            className={cn(
              "rounded-md px-2 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {LANGUAGE_ENDONYMS[locale]}
          </button>
        );
      })}
    </fieldset>
  );
}

/**
 * El mismo selector en una pantalla CON sesión: el wizard de alta (Carlos,
 * 2026-10-31). Además de cambiar la pantalla, guarda el idioma en la cuenta
 * por `PATCH /me`, igual que «Preferencias» de Mi perfil; sin eso,
 * `installAccountLanguageSync` regresaría al idioma de la cuenta en la
 * siguiente carga. El cambio se ve al instante y, si el guardado falla, la
 * pantalla vuelve al idioma anterior.
 */
function AccountLanguageSwitcher() {
  const { i18n } = useTranslation();
  const updateLocale = useUpdateLocale();

  const handleSelect = (next: Locale) => {
    const previous = i18n.resolvedLanguage ?? i18n.language;
    void i18n.changeLanguage(next);
    updateLocale.mutate(next, {
      onSuccess: () => {
        const { user, setUser } = useAuthStore.getState();
        if (user) {
          setUser({ ...user, locale: next });
        }
      },
      onError: () => {
        void i18n.changeLanguage(previous);
      },
    });
  };

  return <LanguageSwitcher onSelect={handleSelect} />;
}

export { AccountLanguageSwitcher, LanguageSwitcher };
