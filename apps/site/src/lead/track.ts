// F11-SITE-SEO-06 — la medición, contra el API propio. Cinco eventos, los que
// dicen si el sitio VENDE (CONTENIDO §13); lo demás es vanidad.
//
// Lo que se manda: el evento, el mercado, el idioma, la sección, el plan y el
// DOMINIO de donde llegó la visita (nunca la URL). Lo que NO: nada que
// identifique a la persona — ni cookie, ni identificador, ni huella. Por eso no
// hay aviso de consentimiento y el aviso de privacidad no tiene nada que declarar.
//
// `sendBeacon` no frena la navegación ni se pierde al salir de la página, que
// es justo cuando ocurre un clic en «Empieza gratis».
import { getLocale, isRoute } from "../config/markets";
import { SITE_EVENTS_URL } from "./api";

export const SITE_EVENTS = [
  "cta_click",
  "form_open",
  "form_submit",
  "market_change",
  "plans_expand",
] as const;
export type SiteEvent = (typeof SITE_EVENTS)[number];

/** `https://www.google.com/search?q=…` → `google.com`. Un origen propio o vacío → nada. */
export function referrerDomain(referrer: string, ownHost: string): string | undefined {
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    return host && host !== ownHost.replace(/^www\./, "") ? host : undefined;
  } catch {
    return undefined;
  }
}

/** La versión del sitio que se está viendo: la dice `<html data-route>`. */
function currentRoute() {
  const route = document.documentElement.dataset.route;
  return isRoute(route) ? route : null;
}

export function track(event: SiteEvent, data: { section?: string; plan?: string } = {}): void {
  try {
    const route = currentRoute();
    if (!route || !navigator.sendBeacon) return;
    const { market, language } = getLocale(route);
    const payload = {
      event,
      market,
      locale: language,
      ...data,
      referrerDomain: referrerDomain(document.referrer, location.hostname),
    };
    // `text/plain` A PROPÓSITO: con `application/json` la petición deja de ser
    // «simple» y el navegador manda antes un preflight de CORS. El momento
    // típico de un beacon es la página cerrándose, donde ese OPTIONS puede no
    // completarse y el evento se pierde en silencio. El API lo lee como JSON.
    navigator.sendBeacon(
      SITE_EVENTS_URL,
      new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" }),
    );
  } catch {
    // La medición JAMÁS rompe la página: si algo truena, se pierde el evento.
  }
}
