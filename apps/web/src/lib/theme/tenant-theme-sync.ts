import { useAuthStore } from "@/stores/auth.store";
import { applyTheme } from "./apply-theme";

/**
 * El tema de la CUENTA manda apenas se conoce — el gemelo exacto de
 * `installAccountLanguageSync` (lib/auth/ui-language.ts) y por los mismos
 * motivos: UNA suscripción al store en vez de una llamada en cada lugar que
 * crea sesión, para que no exista un lugar que olvidar.
 *
 * La guarda del `previous` es la que protege los flujos OPTIMISTAS: el
 * wizard y el selector de Mi perfil aplican el tema al documento ANTES de
 * que el PATCH responda; un `setToken` del refresh o un resync que no tocó
 * el tema no deben pisar esa vista previa.
 *
 * Cerrar sesión (user → undefined) NO revierte al default a propósito: quien
 * cierra sesión en un negocio arena no necesita un fogonazo blanco camino al
 * login, y el próximo login aplicará el tema que corresponda.
 */
export function installTenantThemeSync(): () => void {
  return useAuthStore.subscribe((state, previous) => {
    const theme = state.user?.tenant.theme;
    if (theme === undefined || theme === previous.user?.tenant.theme) {
      return;
    }
    applyTheme(theme);
  });
}
