import { SetMetadata } from "@nestjs/common";

/**
 * F11-SITE-LEAD-03 / F11-SITE-SEO-06 — los dos presupuestos por IP del sitio
 * público, en un solo lugar.
 *
 * Son dos cosas muy distintas y por eso no comparten balde: escribirnos es un
 * acto raro (cinco veces en una hora ya es un robot), y medir es constante
 * (una visita normal dispara varios eventos por minuto). Un único límite o
 * ahogaría la medición o dejaría pasar el spam.
 */
export interface SiteThrottle {
  /** Entra en la clave de Redis: `throttle:{name}:{ip}`. */
  name: string;
  limit: number;
  ttlSec: number;
}

export const SITE_THROTTLES = {
  /** Cinco mensajes por hora desde la misma IP. */
  lead: { name: "site-lead", limit: 5, ttlSec: 3_600 },
  /**
   * Generoso a propósito: una visita real dispara varios eventos y una
   * oficina entera comparte la IP (NAT). Frena a un robot que quisiera
   * ensuciar los conteos, no a la gente.
   */
  event: { name: "site-event", limit: 120, ttlSec: 60 },
  /**
   * F11-SITE-LEGAL-04: la baja de los correos comerciales. Un clic por
   * persona, pero el balde no puede ser de uno: los escáneres de enlaces de
   * Outlook y Gmail hacen prefetch, y varios correos leídos desde la misma
   * oficina comparten IP. Veinte por hora frena a quien quisiera probar
   * firmas en serie sin estorbarle a nadie real.
   */
  unsubscribe: { name: "site-unsubscribe", limit: 20, ttlSec: 3_600 },
} as const satisfies Record<string, SiteThrottle>;

export const SITE_THROTTLE_KEY = "siteThrottle";

/**
 * Qué presupuesto le toca a este handler.
 *
 * Es un decorador y no un mapa de nombres de método (como el de `/auth/*`)
 * porque acá renombrar un handler tiene que fallar del lado seguro: sin
 * metadata, `SiteThrottlerGuard` aplica el balde MÁS ESTRICTO y avisa — un
 * mapa por nombre dejaría el endpoint sin límite en silencio.
 */
export const SiteThrottle = (throttle: SiteThrottle) => SetMetadata(SITE_THROTTLE_KEY, throttle);

/** La clave de Redis. Mismo contrato que el resto: `throttle:{name}:{tracker}`. */
export function siteThrottleKey(name: string, ip: string | undefined): string {
  return `throttle:${name}:${ip}`;
}
