import type { i18n as I18nInstance } from "i18next";
import { useAuthStore } from "@/stores/auth.store";

/**
 * CONTRAPESO DEL INGLÉS-FIRST (decisión de Carlos, 2026-08-16).
 *
 * `INITIAL_LOCALE` (`i18n/index.ts`) hace que las pantallas públicas
 * arranquen en inglés. Eso está bien ANTES de saber quién es la persona,
 * pero deja de estarlo en el instante en que hay sesión: un cliente mexicano
 * con `locale: "es"` en su cuenta, entrando desde un navegador nuevo,
 * aterrizaría en un dashboard en inglés. El idioma de la CUENTA manda apenas
 * se conoce.
 *
 * Se implementa como UNA suscripción al store en vez de una llamada en cada
 * lugar que crea sesión (login, bootstrap de refresh, aceptación de
 * invitación...) justamente para que no haya un lugar que olvidar: cualquiera
 * que ponga un `user` en el store mueve el idioma. Es el mismo criterio de
 * `clearAuth` como puerta única en `auth.store.ts`.
 *
 * Dos guardas, y las dos importan:
 * 1. Solo reacciona si el `locale` CAMBIÓ — un `setToken` del refresh o un
 *    `setUser` de resync de permisos no tocan el idioma.
 * 2. No llama a `changeLanguage` si ya se está viendo ese idioma. Esto es lo
 *    que evita pisar el flujo optimista del selector de `/profile`, que
 *    cambia el idioma ANTES de que `PATCH /me` responda y solo después
 *    escribe el `user` en el store.
 *
 * Efecto lateral deseado: `changeLanguage` pasa por el cache en localStorage
 * del detector, así que tras el primer login la pantalla de `/login` ya
 * aparece en el idioma de la cuenta en ese navegador.
 */
export function installAccountLanguageSync(instance: I18nInstance): () => void {
  return useAuthStore.subscribe((state, previous) => {
    const locale = state.user?.locale;
    if (!locale || locale === previous.user?.locale) {
      return;
    }
    if (locale === (instance.resolvedLanguage ?? instance.language)) {
      return;
    }
    void instance.changeLanguage(locale);
  });
}
